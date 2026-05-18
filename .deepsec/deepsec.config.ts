import { defineConfig } from "deepsec/config";

export default defineConfig({
  projects: [
    { id: "vscode-dslop", root: ".." },
    // <deepsec:projects-insert-above>
  ],
});
