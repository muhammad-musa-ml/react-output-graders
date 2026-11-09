import { request } from "node:http";

const HOST = new URL(process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434");
const LIMIT_MS = 20 * 60 * 1000;

// node:http, not fetch: fetch gives up after 5 minutes without response
// headers, and a non-streaming reply sends none until it is finished, which
// is too short when the GPU is shared and the request waits in Ollama's queue.
function post(path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = request(
      { hostname: HOST.hostname, port: HOST.port, path, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode !== 200) reject(new Error(`ollama ${res.statusCode}: ${text.slice(0, 200)}`));
          else resolve(JSON.parse(text));
        });
      },
    );
    req.setTimeout(LIMIT_MS, () => req.destroy(new Error(`no answer from ollama in ${LIMIT_MS / 60000} minutes`)));
    req.on("error", reject);
    req.end(body);
  });
}

// One chat turn. Returns the reply text, the tokens generated and the seconds taken.
export async function chat({ model, messages, seed, temperature = 0.7, numPredict = 3500, numCtx = 4096 }) {
  const started = Date.now();
  const data = await post("/api/chat", {
    model,
    messages,
    stream: false,
    // 4096 is what other clients of a shared server usually load, and a
    // different num_ctx makes Ollama reload the model. A repair turn sends the
    // first prompt and reply back, so it asks for more.
    options: { temperature, top_p: 0.9, seed, num_ctx: numCtx, num_predict: numPredict },
  });
  return {
    text: data.message?.content ?? "",
    tokens: data.eval_count ?? 0,
    promptTokens: data.prompt_eval_count ?? 0,
    numCtx,
    seconds: (Date.now() - started) / 1000,
    done: data.done_reason ?? "",
  };
}
