import { rm } from "node:fs/promises";

// Only generated output is removed; source files and local evidence stay intact.
await rm(new URL("../dist/", import.meta.url), { recursive: true, force: true });
