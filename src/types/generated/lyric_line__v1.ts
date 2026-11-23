import { z } from "zod"

export const lyricLineV1Schema = z.object({ "text": z.string().describe("The line as sung or shown."), "line_index": z.union([z.number().int().gte(0), z.null()]).describe("Index of the line in the song or file.").default(null), "section": z.union([z.string(), z.null()]).describe("Label of the song section the line belongs to.").default(null) }).catchall(z.any()).describe("A line of text, with its position in the song.")
