Dorca 2.0.9 improves JavaScript and TypeScript editor highlighting for VS Code-style themes.

- Functions and callable properties receive function colors, including arrow-function declarations and calls.
- Constants receive constant colors, while parameters, mutable variables and class properties keep their own categories.
- Control-flow keywords such as `export` and `return` can use different colors from `class`, `private` and other declaration keywords.
- JSX and TSX retain their language features, and words inside comments, strings and JSX text keep their existing syntax colors.
- Highlighting reuses the editor's TypeScript worker and follows the selected editor theme.

Includes stable [Orca v1.4.257](https://github.com/stablyai/orca/releases/tag/v1.4.257), upstream commit `b0570d90fc9af8c9e7e3566c0fb841d0884e2462`.
