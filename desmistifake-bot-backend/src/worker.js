export default {
  async fetch(request, env) {

    const url = new URL(request.url);
    if (url.pathname !== "/" && url.pathname !== "") {
      return new Response("Not found", { status: 404 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Método não permitido", { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Body inválido", { status: 400 });
    }

    const { conversationHistory } = body;
    if (!conversationHistory || !Array.isArray(conversationHistory)) {
      return new Response("conversationHistory inválido", { status: 400 });
    }

    const lastMessage = conversationHistory.filter(m => m.role === "user").at(-1)?.content || "";

    const embeddingResult = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: [lastMessage]
    });
    const queryEmbedding = embeddingResult.data[0];

    const searchResult = await env.VECTORIZE.query(queryEmbedding, {
      topK: 5,
      returnMetadata: "all"
    });

    const usefulContent = searchResult.matches.filter(m => m.score >= 0.70).map(m => ({
      titulo: m.metadata.titulo,
      tema:m.metadata.tema,
      texto:m.metadata.texto
    }));

    const SYSTEM_PROMPT = usefulContent.length > 0
      ? `Você é o Desmistifake, assistente oficial do projeto Desmistifake Saúde da Unisinos.

      REGRA PRINCIPAL: Responda APENAS com base nos trechos dos nossos artigos fornecidos abaixo. Não use conhecimento externo.

      SEU JEITO DE FALAR:
      - Fale de forma leve, direta e acessível. Nada de linguagem super formal.
      - Um emoji ocasional tá ótimo.
      - Respostas curtas e objetivas.

      REGRAS:
      1. Responda com base nos trechos abaixo e cite o título do artigo de origem.
      2. Nunca invente informações além do que está nos trechos.
      3. Não diagnostique doenças nem prescreva medicamentos.

      TRECHOS DOS NOSSOS ARTIGOS:
      ${usefulContent.map((t, i) => `--- Trecho ${i + 1} (Artigo: "${t.titulo}" | Tema: ${t.tema}) ---\n${t.texto}`).join("\n\n")}`

        : `Você é o Desmistifake, assistente oficial do projeto Desmistifake Saúde da Unisinos.

      Nenhum artigo relevante foi encontrado para essa pergunta. Responda APENAS com:
      "Esse tema ainda não está coberto pelos nossos materiais. Mas você pode explorar os artigos do projeto em desmistifake.unisinos.br 😊"`;

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.GROQ_API_KEY}`, // vem do Secret (próximo passo)
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...conversationHistory,
        ],
      }),
    });

    const data = await groqResponse.json();

    if (!groqResponse.ok) {
      return new Response(JSON.stringify({ error: data.error?.message }), {
        status: groqResponse.status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const reply = data.choices[0].message.content.replace(/\*\*(.*?)\*\*/g, "$1").trim();

    return new Response(JSON.stringify({ reply }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
};