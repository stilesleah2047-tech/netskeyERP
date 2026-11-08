import mongoose from "mongoose";

/** True for a well-formed 24-hex MongoDB ObjectId string. */
export function isObjectId(id: unknown): id is string {
  return typeof id === "string" && /^[a-f0-9]{24}$/i.test(id) && mongoose.Types.ObjectId.isValid(id);
}
