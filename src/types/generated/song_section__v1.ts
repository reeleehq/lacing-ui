import { z } from "zod"

export const songSectionV1Schema = z.object({ "label": z.string().describe("Section id, e.g. 'verse_1', 'chorus'."), "title": z.union([z.string(), z.null()]).describe("Display title, e.g. 'verse 1'.").default(null), "energy": z.union([z.string(), z.null()]).describe("Energy level, e.g. 'high'.").default(null), "mood": z.union([z.string(), z.null()]).describe("Mood, e.g. 'wistful'.").default(null) }).catchall(z.any()).describe("A labelled section of a song, with optional descriptors.")
