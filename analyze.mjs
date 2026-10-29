// HypoDiabetic Monitor - AI analysis endpoint (Netlify Function).
// Receives a resized JPEG (base64) and a task name, asks Claude, returns its text.
// Prompts live here on the server so the API key cannot be used for arbitrary requests.
// Required environment variable: ANTHROPIC_API_KEY. Optional: CLAUDE_MODEL.

const CONDITIONS = {
  both: "type 2 diabetes and hypertension",
  diabetes: "diabetes",
  hypertension: "hypertension",
};

function platePrompt(cond, hint) {
  return `You estimate nutrition from a meal photo for someone managing ${cond}.
${hint ? "The person says the plate contains: " + hint + "\n" : ""}Identify each food item, estimate its portion (grams or household measure), carbohydrate grams and sodium mg. Then estimate the whole meal's total carbs, glycemic load (GL, using typical glycemic index values for each food), sodium mg and added sugar g. Consider South Asian, East Asian and Western dishes.
Reply with only JSON in this shape:
{"meal_name":"short name","items":[{"name":"","portion":"","carbs_g":0,"sodium_mg":0}],"total_carbs_g":0,"glycemic_load":0,"sodium_mg":0,"added_sugar_g":0,"confidence":"low|medium|high","reason":"one sentence on the main glucose or blood-pressure driver","swap_tip":"one concrete swap that lowers GL or sodium"}
If the image does not show food, reply {"not_food":true}.`;
}

function mealTextPrompt(cond, text) {
  return `You estimate nutrition for someone managing ${cond} from a typed description of what they ate: "${text}".
Assume typical home or restaurant portions unless amounts are given. Consider South Asian, East Asian and Western dishes.
Reply with only JSON in this shape:
{"meal_name":"short name","items":[{"name":"","portion":"","carbs_g":0,"sodium_mg":0}],"total_carbs_g":0,"glycemic_load":0,"sodium_mg":0,"added_sugar_g":0,"confidence":"low|medium|high","reason":"one sentence on the main glucose or blood-pressure driver","swap_tip":"one concrete swap that lowers GL or sodium"}
If the text does not describe food or drink, reply {"not_food":true}.`;
}

function labelPrompt(cond) {
  return `Read the label in this photo for someone managing ${cond}. It is either a food nutrition label or a medicine package.
Reply with only JSON:
{"kind":"nutrition|medication|unknown","product":"name if visible","serving":"serving size text","per_serving":{"carbs_g":null,"sugar_g":null,"added_sugar_g":null,"sodium_mg":null,"fiber_g":null,"sat_fat_g":null},"flags":["short warnings, e.g. high sodium (>600 mg/serving), hidden sugars by their ingredient names, high saturated fat"],"medication":{"name":"","active_ingredients":[""],"food_interactions":["well-established interactions relevant to diabetes or blood pressure, e.g. grapefruit with some calcium-channel blockers, potassium-rich salt substitutes with ACE inhibitors, alcohol with metformin, decongestants raising BP, NSAIDs raising BP"]},"summary":"two sentences, plain language"}
Use null for anything not readable. For a nutrition label, leave medication fields empty. Only list interactions that apply to the ingredients you can read.`;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async (req) => {
  // GET = setup check used by the app to show whether AI scanning is ready.
  if (req.method === "GET") return json({ ok: true, configured: !!process.env.ANTHROPIC_API_KEY });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: "server_not_configured" }, 500);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const { task, image } = body || {};
  const cond = CONDITIONS[body?.condition] || CONDITIONS.both;
  const hint = typeof body?.hint === "string" ? body.hint.slice(0, 200) : "";

  if (!["plate", "label", "meal_text"].includes(task)) return json({ error: "bad_request" }, 400);
  const mealText = typeof body?.text === "string" ? body.text.replace(/["\\`]/g, "'").slice(0, 300).trim() : "";
  if (task === "meal_text") {
    if (!mealText) return json({ error: "bad_request" }, 400);
  } else if (typeof image !== "string" || image.length < 100 || image.length > 5_000_000) {
    // ~3.7 MB of JPEG at most; the app sends about 150-400 KB.
    return json({ error: "image_rejected" }, 400);
  }

  let prompt = task === "plate" ? platePrompt(cond, hint) : task === "label" ? labelPrompt(cond) : mealTextPrompt(cond, mealText);
  if (body?.lang === "zh") {
    prompt += "\nWrite every human-readable text value (names, portions, reasons, tips, flags, summary, interactions) in Traditional Chinese as used in Taiwan. Keep the JSON keys and the fixed values (low|medium|high, nutrition|medication|unknown) in English.";
  }

  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: task === "meal_text"
              ? [{ type: "text", text: prompt }]
              : [
                  { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
                  { type: "text", text: prompt },
                ],
          },
        ],
      }),
    });
  } catch {
    return json({ error: "upstream_error" }, 502);
  }

  if (r.status === 429 || r.status === 529) return json({ error: "rate_limited" }, 429);
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    console.error("Anthropic API error", r.status, detail);
    if (r.status === 401 || r.status === 403) return json({ error: "bad_api_key" }, 502);
    if (/credit balance|billing|purchase credits/i.test(detail)) return json({ error: "no_credit" }, 502);
    if (r.status === 404 || /model/i.test(detail) && r.status === 400) return json({ error: "bad_model" }, 502);
    return json({ error: "upstream_error" }, 502);
  }

  const data = await r.json();
  const text = (data.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
  if (!text) return json({ error: "refused" }, 422);
  return json({ text });
};
