import { z } from "zod"

export const alignedTextV1Schema = z.object({ "text": z.string().describe("The full text the spans' ``chars`` index."), "language": z.union([z.string(), z.null()]).describe("BCP 47 tag, when known.").default(null) }).strict().describe("The text of a track, stored once, on one annotation spanning the asset.")
