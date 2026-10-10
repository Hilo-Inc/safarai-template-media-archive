/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    role: import('./lib/session').Role | null;
  }
}
