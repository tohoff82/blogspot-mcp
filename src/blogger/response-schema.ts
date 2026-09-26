import { z } from "zod";

export const bloggerInsertResponseSchema = z.object({
  id: z.string().optional()
}).passthrough();

export const bloggerPostResponseSchema = z.object({
  id: z.string().min(1),
  blog: z.object({ id: z.string().optional() }).passthrough().optional(),
  status: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  labels: z.array(z.string()).optional(),
  customMetaData: z.string().optional()
}).passthrough();
