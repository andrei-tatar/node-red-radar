import typescript from "@rollup/plugin-typescript";
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
    typescript({
      tsconfig: "tsconfig.rollup.json",
      compilerOptions: {
        sourceMap: isDevMode,
      },
    }),
    commonjs({
      include: /node_modules/,
    }),
    nodeResolve({
      browser: true,
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
