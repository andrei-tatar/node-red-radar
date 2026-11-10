import sucrase from "@rollup/plugin-sucrase";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import replace from "@rollup/plugin-replace";
import terser from "@rollup/plugin-terser";
import livereload from "rollup-plugin-livereload";

const isDevMode = process.env.NODE_ENV === "development";
const mode = isDevMode ? "development" : "production";

console.log(`${mode} mode bundle`);

export default {
  input: "src/browser/index.tsx",
  output: {
    sourcemap: isDevMode ? "inline" : false,
    dir: "static",
    format: "iife",
  },
  plugins: [
    replace({
      preventAssignment: true,
      "process.env.NODE_ENV": JSON.stringify(mode),
    }),
    // strips types only (TypeScript 7 has no JS API for a rollup plugin);
    // type checking runs separately with tsc. JSX is left to rollup's own
    // classic transform below.
    sucrase({
      include: ["src/**"],
      transforms: ["typescript", "jsx"],
      jsxRuntime: "preserve",
    }),
    commonjs({
      include: /node_modules/,
    }),
    nodeResolve({
      browser: true,
      extensions: [".ts", ".tsx", ".mjs", ".js", ".json"],
    }),
    !isDevMode && terser(),
    isDevMode &&
      livereload({
        delay: 100,
      }),
  ],
  jsx: {
    mode: "classic",
    factory: "React.createElement",
    fragment: "React.Fragment",
    importSource: "react",
  },
  onwarn: function (warning, warn) {
    if (warning.code === "MODULE_LEVEL_DIRECTIVE") {
      return;
    }
    warn(warning);
  },
};
