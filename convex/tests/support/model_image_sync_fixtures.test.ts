export const gptImageModel = {
  id: "openai/gpt-image-2",
  name: "OpenAI: GPT Image 2",
  description: "High-fidelity generation through the dedicated Images API.",
  architecture: {
    input_modalities: ["text", "image"],
    output_modalities: ["image"],
  },
  supported_parameters: {
    quality: { type: "enum", values: ["auto", "low", "medium", "high"] },
    n: { type: "range", min: 1, max: 10 },
    input_references: { type: "range", min: 0, max: 16 },
  },
  supports_streaming: true,
};

export const gptImageEndpoints = {
  id: "openai/gpt-image-2",
  endpoints: [{
    provider_name: "OpenAI",
    provider_slug: "openai",
    supported_parameters: gptImageModel.supported_parameters,
    allowed_passthrough_parameters: ["moderation"],
    supports_streaming: true,
    pricing: [{
      billable: "output_image",
      unit: "token",
      cost_usd: 0.00003,
    }],
  }],
};
