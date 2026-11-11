{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  packages = with pkgs; [
    nodejs_24 # Builds, tests and publishes the library.
    openssh # ssh-keygen makes the keys the agent tests sign with.
    openssl # Makes the self-signed certificates the certificate tests serve.
    git
  ];
}
