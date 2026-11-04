/**
 * FILE: apps/web/src/lib/cn.ts
 * PART: website (apps/web)
 * WHAT IT DOES: A tiny helper for combining CSS class names. The website is styled with Tailwind, where each
 *   look is a short class name (e.g. "p-4" = padding, "text-red-600" = red text). Components often need
 *   "these classes always, plus that one only when a condition is true"; `cn(...)` does that joining.
 * WHERE IT RUNS: both — server and browser components use it.
 * FRAMEWORK NOTES: `clsx` is a small npm library. `cn("a", isActive && "b", { c: hasError })` returns
 *   "a b c" when both conditions are true and just "a" when both are false.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `type ClassValue` in the import = bring in a type only (a description of allowed values), not code.
 *   - rest parameters `...inputs: ClassValue[]` = "accept any number of arguments, collected into an array".
 *   - `X[]` = "an array (list) of X".
 */

// `import { a, type B } from "lib"` loads the function `clsx` and the type `ClassValue` from the npm library clsx.
import { clsx, type ClassValue } from "clsx";

/**
 * Kind: constant holding an arrow function.
 * @param inputs  type `ClassValue[]` — any number of class names, false/undefined values (ignored), arrays or
 *                `{ className: condition }` objects.
 * @returns       `string`: the class names that apply, joined by spaces.
 */
export const cn = (...inputs: ClassValue[]) => clsx(inputs);
