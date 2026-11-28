# What every X-app's flake builds the same way: the server package, the desktop package, the NixOS module and the dev
# shells. An app describes itself once and passes that, with its package set, to each function:
#
#   app = {
#     name = "x-budget"; display_name = "X-Budget"; env_prefix = "X_BUDGET"; src = ../.;
#     description = "Budgets, monthly transactions and reports, synced through your own server";
#     module_description = "a web app for budgets and monthly transactions that its devices sync with";
#     desktop_comment = "Budgets, monthly transactions and reports";
#     port = 7740; database_file = "budget.db"; sync_example = "https://budget.example.org/api/";
#   };
{
  # ── Server ─────────────────────────────────────────────────────────────────

  # The web server, run from its .ts files by Node; the app lives in lib/<name>, since Node will not run .ts files
  # from under a node_modules folder.
  package =
    pkgs: app:
    let
      inherit (pkgs) lib;
      nodejs = pkgs.nodejs_24;
      has = path: builtins.pathExists (app.src + "/${path}");
      shared_sources = builtins.filter has [
        "src/app.ts"
        "src/server"
        "src/shared"
      ];
    in
    pkgs.buildNpmPackage {
      pname = app.name;
      version = (lib.importJSON (app.src + "/package.json")).version;
      src = lib.cleanSource app.src;

      inherit nodejs;
      # Read from package-lock.json, so there is no deps hash to keep in step with it.
      npmDeps = pkgs.importNpmLock { npmRoot = app.src; };
      npmConfigHook = pkgs.importNpmLock.npmConfigHook;
      env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

      nativeBuildInputs = [ pkgs.makeWrapper ];

      installPhase = ''
        runHook preInstall

        npm prune --omit=dev --no-save --ignore-scripts

        mkdir -p $out/lib/${app.name}/src $out/lib/${app.name}/out
        cp -r package.json node_modules $out/lib/${app.name}/
        cp -r out/web $out/lib/${app.name}/out/
        cp -r ${lib.concatStringsSep " " shared_sources} $out/lib/${app.name}/src/

        makeWrapper ${lib.getExe nodejs} $out/bin/${app.name} \
          --add-flags "--disable-warning=ExperimentalWarning $out/lib/${app.name}/src/server/main.ts" \
          --set-default NODE_ENV production
      ''
      + lib.optionalString (has "src/server/hash_password.ts") ''

        makeWrapper ${lib.getExe nodejs} $out/bin/${app.name}-hash-password \
          --add-flags "--disable-warning=ExperimentalWarning $out/lib/${app.name}/src/server/hash_password.ts"
      ''
      + ''

        runHook postInstall
      '';

      meta = {
        inherit (app) description;
        license = lib.licenses.gpl3Plus;
        mainProgram = app.name;
      };
    };

  # ── Desktop ────────────────────────────────────────────────────────────────

  # The Electron app with its own daemon, run on nixpkgs' Electron, since the npm one cannot run on NixOS.
  desktop_package =
    pkgs: app:
    let
      inherit (pkgs) lib;
      electron = app.electron or pkgs.electron_45;
    in
    pkgs.buildNpmPackage {
      pname = "${app.name}-desktop";
      version = (lib.importJSON (app.src + "/package.json")).version;
      src = lib.cleanSource app.src;

      nodejs = pkgs.nodejs_24;
      npmDeps = pkgs.importNpmLock { npmRoot = app.src; };
      npmConfigHook = pkgs.importNpmLock.npmConfigHook;
      env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

      nativeBuildInputs = [
        pkgs.makeWrapper
        pkgs.copyDesktopItems
      ];

      npmBuildScript = "build:desktop";

      installPhase = ''
        runHook preInstall

        npm prune --omit=dev --no-save --ignore-scripts
        mkdir -p $out/lib/${app.name}-desktop
        cp -r out resources package.json node_modules $out/lib/${app.name}-desktop/
        install -Dm644 resources/icon.svg $out/share/icons/hicolor/scalable/apps/${app.name}.svg
        makeWrapper ${lib.getExe electron} $out/bin/${app.name}-desktop \
          --add-flags $out/lib/${app.name}-desktop \
          --unset ELECTRON_RUN_AS_NODE

        runHook postInstall
      '';

      desktopItems = [
        (pkgs.makeDesktopItem {
          name = app.name;
          desktopName = app.display_name;
          comment = app.desktop_comment;
          exec = "${app.name}-desktop";
          icon = app.name;
          categories = app.desktop_categories or [ "Utility" ];
        })
      ];

      meta = {
        description = "${app.display_name} as a desktop app with its own database";
        license = lib.licenses.gpl3Plus;
        mainProgram = "${app.name}-desktop";
      };
    };

  # ── NixOS ──────────────────────────────────────────────────────────────────

  # services.<name>: the web server under a dynamic user, its data in /var/lib/<name>, its admins from a file.
  module =
    self: app:
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      cfg = config.services.${app.name};
      inherit (lib)
        literalExpression
        mkEnableOption
        mkIf
        mkOption
        types
        ;

      state_directory = "/var/lib/${app.name}";

      config_file = (pkgs.formats.json { }).generate "${app.name}.json" (
        {
          database = "${state_directory}/${app.database_file}";
          backups_folder = "${state_directory}/backups";
        }
        // lib.optionalAttrs (cfg.syncAddress != null) { sync_address = cfg.syncAddress; }
      );
    in
    {
      options.services.${app.name} = {
        enable = mkEnableOption "${app.display_name}, ${app.module_description}";

        package = mkOption {
          type = types.package;
          default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
          defaultText = literalExpression "${app.name} (from flake)";
          description = "The ${app.display_name} package to use.";
        };

        host = mkOption {
          type = types.str;
          default = "127.0.0.1";
          description = "Address the page, API and sync listen on.";
        };

        port = mkOption {
          type = types.port;
          default = app.port;
          description = "Port the page, API and sync listen on.";
        };

        syncAddress = mkOption {
          type = types.nullOr types.str;
          default = null;
          example = app.sync_example;
          description = "Where devices reach this server's sync, ending in /api/; without it devices can still pair from a code made on another device.";
        };

        openFirewall = mkOption {
          type = types.bool;
          default = false;
          description = "Open the port in the firewall.";
        };

        adminsFile = mkOption {
          type = types.str;
          description = ''
            File of `name:hash` lines for the admins, made with `${app.name}-hash-password <name> <file>`. Everyone else
            is added from the page by an admin.
          '';
        };
      };

      config = mkIf cfg.enable {
        systemd.services.${app.name} = {
          description = app.display_name;
          wantedBy = [ "multi-user.target" ];
          after = [ "network.target" ];

          environment = {
            "${app.env_prefix}_CONFIG" = toString config_file;
            "${app.env_prefix}_HOST" = cfg.host;
            "${app.env_prefix}_PORT" = toString cfg.port;
            "${app.env_prefix}_PASSWORD_HASH_FILE" = "%d/admins";
          };

          serviceConfig = {
            ExecStart = lib.getExe cfg.package;
            DynamicUser = true;
            StateDirectory = app.name;
            StateDirectoryMode = "0700";
            LoadCredential = [ "admins:${cfg.adminsFile}" ];
            Restart = "on-failure";
            RestartSec = "5s";

            CapabilityBoundingSet = "";
            LockPersonality = true;
            NoNewPrivileges = true;
            PrivateDevices = true;
            ProtectClock = true;
            ProtectControlGroups = true;
            ProtectHome = true;
            ProtectHostname = true;
            ProtectKernelLogs = true;
            ProtectKernelModules = true;
            ProtectKernelTunables = true;
            ProtectSystem = "strict";
            RestrictAddressFamilies = [
              "AF_INET"
              "AF_INET6"
              "AF_UNIX"
            ];
            RestrictNamespaces = true;
            RestrictRealtime = true;
            SystemCallArchitectures = "native";
            SystemCallFilter = [ "@system-service" ];
            UMask = "0077";
          };
        };

        networking.firewall.allowedTCPPorts = mkIf cfg.openFirewall [ cfg.port ];
      };
    };

  # ── Shells ─────────────────────────────────────────────────────────────────

  # Node, git and, for a desktop app, nixpkgs' Electron in place of the npm one, which cannot run on NixOS.
  shell =
    pkgs: app:
    let
      electron = app.electron or pkgs.electron_45;
      desktop = app.desktop or true;
    in
    pkgs.mkShell {
      packages = [
        pkgs.nodejs_24
        pkgs.git
      ]
      ++ pkgs.lib.optional desktop electron
      ++ (app.shell_packages or [ ]);

      shellHook = pkgs.lib.optionalString desktop ''
        # VSCode's terminal exports this, which makes Electron run as bare node and die on the ESM main.
        unset ELECTRON_RUN_AS_NODE
        export ELECTRON_SKIP_BINARY_DOWNLOAD=1
        export ELECTRON_OVERRIDE_DIST_PATH="${electron}/libexec/electron"
        export ELECTRON_EXEC_PATH="${electron}/bin/electron"
      '';
    };

  # For the phone app: `nix develop ./nix#android`, then `npm run build:android` and `cd android && ./gradlew assembleDebug`.
  # The Android SDK is unfree and needs its license accepted, so only this shell uses that package set.
  android_shell =
    nixpkgs: system:
    let
      android_pkgs = import nixpkgs {
        inherit system;
        config = {
          allowUnfree = true;
          android_sdk.accept_license = true;
        };
      };
      build_tools = "35.0.0";
      android_sdk =
        (android_pkgs.androidenv.composeAndroidPackages {
          platformVersions = [ "36" ];
          buildToolsVersions = [ build_tools ];
        }).androidsdk;
    in
    android_pkgs.mkShell {
      packages = [
        android_pkgs.nodejs_24
        android_pkgs.jdk21
        android_sdk
      ];
      shellHook = ''
        export ELECTRON_SKIP_BINARY_DOWNLOAD=1
        export ANDROID_HOME="${android_sdk}/libexec/android-sdk"
        export ANDROID_SDK_ROOT="$ANDROID_HOME"
        export JAVA_HOME="${android_pkgs.jdk21.home}"
        # Gradle fetches its own aapt2, which cannot run on NixOS, so it is pointed at the SDK's.
        export GRADLE_OPTS="-Dorg.gradle.project.android.aapt2FromMavenOverride=$ANDROID_HOME/build-tools/${build_tools}/aapt2"
      '';
    };
}
