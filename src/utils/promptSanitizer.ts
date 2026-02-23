const SYSTEM_PROMPT = `You are a STRICT scene sanitizer that captures ESSENCE without IP.

YOUR JOB:
1. Extract the aesthetic DNA: genre, mood, era, set design, props, color palette
2. Translate IP-specific elements into generic equivalents
3. Keep meaningful props as generic versions

STRICT RULES:
- NO characters, people, creatures, humanoids — environments ONLY
- NO copyrighted names, titles, brands
- NO recognizable trademarked aesthetics verbatim
- NO nudity, gore, violence, weapons, blood
- NO suggestive or adult themes

OUTPUT:
- Cinematic scene description: lighting, materials, camera angle, atmosphere
- Return ONLY the sanitized prompt. No preamble, no explanation.`

async function sanitizePromptDirect(rawPrompt, openaiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: rawPrompt }
      ],
      max_tokens: 250,
      temperature: 0.7
    })
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error('OpenAI API error: ' + text)
  }

  const data = await response.json()
  return data.choices[0]?.message?.content?.trim() || rawPrompt
}

async function generateSeedImageDirect(prompt, falKey) {
  const response = await fetch('https://fal.run/rundiffusion-fal/juggernaut-flux/lightning', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${falKey}`
    },
    body: JSON.stringify({
      prompt: prompt,
      image_size: { width: 640, height: 360 },
      num_inference_steps: 4,
      enable_safety_checker: true,
      output_format: 'png'
    })
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error('fal.ai API error: ' + text)
  }

  const data = await response.json()
  return data.images?.[0]?.url || null
}

/**
 * Process prompt with optional sanitization and seed image generation
 * @param {string} rawPrompt - User's raw prompt
 * @param {boolean} generateSeed - Whether to generate seed image
 * @param {object} config - Config object with API keys
 * @returns {Promise<{ sanitized_prompt: string, seed_image_url: string|null }>}
 */
export async function applyPrompt(rawPrompt, generateSeed, config) {
  // If we have an OpenAI key, sanitize the prompt
  if (config.api_keys?.openai) {
    const sanitizedPrompt = await sanitizePromptDirect(rawPrompt, config.api_keys.openai)
    let seedImageUrl = null

    if (generateSeed && config.api_keys?.fal) {
      seedImageUrl = await generateSeedImageDirect(sanitizedPrompt, config.api_keys.fal)
    }

    return { sanitized_prompt: sanitizedPrompt, seed_image_url: seedImageUrl }
  }

  // No API keys - pass through raw prompt
  return { sanitized_prompt: rawPrompt, seed_image_url: null }
}
