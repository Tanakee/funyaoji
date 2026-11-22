import * as v from "valibot";

/** 受信した JSON の文字列を読み、スキーマに合えば値を返す。文字列でない・JSON でない・スキーマに合わないときは undefined */
export function parseMessage<const S extends v.GenericSchema>(
  schema: S,
  data: unknown,
): v.InferOutput<S> | undefined {
  if (typeof data !== "string") return undefined;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return undefined;
  }
  const result = v.safeParse(schema, json);
  return result.success ? result.output : undefined;
}
