{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  packages = with pkgs; [
    nodejs_24 # Builds, tests and publishes the library.
    openssh # ssh-keygen makes the keys the agent tests sign with.
    git
  ];
}
