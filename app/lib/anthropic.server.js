import Anthropic from "@anthropic-ai/sdk";

let client = null;

function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it to .env to enable AI keyword suggestions.",
      );
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Given a free-text customer description, ask Claude for a tight list of
 * keywords we can run through the matcher. If we have the shop's existing
 * product tags, pass them so the model prefers vocabulary that already exists
 * in inventory (much higher match rate).
 */
export async function suggestKeywords({ description, vocabulary = [] }) {
  if (!description || !description.trim()) return [];

  // If we have store vocabulary, restrict the model to only those tags.
  const hasVocab = vocabulary.length > 0;
  const vocabBlock = hasVocab
    ? `\n\nYou MUST only choose keywords from this exact list of tags that exist in our store. Do not invent or suggest any word not on this list:\n${vocabulary.slice(0, 300).join(", ")}`
    : "";

  const restriction = hasVocab
    ? "Choose ONLY from the tag list provided. Do not use any word not on that list."
    : "Use short lowercase keywords (single words or 2-word phrases).";

  const prompt = `You are helping a jewelry-store salesperson tag a customer special-order request so it can be matched against existing inventory.

${restriction}${vocabBlock}

Pick 3 to 8 tags that best capture what the customer wants from the description below.

Customer description:
"""
${description.trim()}
"""

Respond with ONLY a comma-separated list of tags. No preamble, no explanation, no extra text. Example:
gold, vintage, ring`;

  const c = getClient();
  const response = await c.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 200,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content?.[0]?.type === "text" ? response.content[0].text : "";

  return text
    .split(/[,\n]/)
    .map((k) =>
      k
        .trim()
        .toLowerCase()
        .replace(/^[-•*\d.)\s]+/, "")
        .replace(/["'.!?]+$/, "")
        .trim(),
    )
    .filter((k) => k.length >= 2 && k.length <= 40)
    .slice(0, 10);
}
