{
  description = "X-App — the base every X-app is built on; its lib builds an app's packages, NixOS module and shells";

  # No inputs: each function takes the app's own package set, so an app's nixpkgs decides every version.
  outputs = { self }: {
    lib = import ./nix/lib.nix;
  };
}
