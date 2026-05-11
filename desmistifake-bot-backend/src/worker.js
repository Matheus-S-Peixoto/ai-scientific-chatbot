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

    const recentMessages = conversationHistory.filter(m => m.role === "user").slice(-3).map(m => m.content).join(" ");

    const searchQuery = recentMessages.replace(/o (grupo|projeto|site) (do |da )?desmistifake/gi, "").replace(/tem algum (artigo|material|conteúdo|texto) sobre/gi, "").replace(/vocês (têm|tem|falam|cobrem) (algo |alguma coisa )?sobre/gi, "").trim();

    const embeddingResult = await env.AI.run("@cf/baai/bge-m3", {
      text: [searchQuery]
    });
    const queryEmbedding = embeddingResult.data[0];

    const searchResult = await env.VECTORIZE.query(queryEmbedding, {
      topK: 5,
      returnMetadata: "all"
    });

    const usefulContent = searchResult.matches.filter(m => m.score >= 0.55).map(m => ({
      titulo: m.metadata.titulo,
      tema:m.metadata.tema,
      texto:m.metadata.texto
    }));

    console.log("Query:", searchQuery);
    console.log("Matches:", JSON.stringify(searchResult.matches.map(m => ({ score: m.score, titulo: m.metadata?.titulo }))));

    const SYSTEM_PROMPT = usefulContent.length > 0
      ? `Você é o Desmistifake, assistente oficial do projeto Desmistifake Saúde da Unisinos.
 
      REGRA PRINCIPAL: Responda APENAS com base nos trechos dos artigos fornecidos abaixo. Nunca use conhecimento externo.
      
      SEU JEITO DE FALAR:
      - Fale como uma pessoa real: leve, direta e acessível. Sem formalidade excessiva.
      - Use no máximo 1 emoji por resposta, só quando fizer sentido. Não force.
      - Respostas curtas e objetivas. Vá direto ao ponto.
      - Nunca repita a pergunta do usuário na resposta.
      
      COMO CITAR A FONTE:
      - Ao final da resposta, mencione o título do artigo de forma natural e discreta.
      - Exemplo: "Esse tema é abordado no artigo 'Nome do artigo', disponível no site do projeto."
      - Nunca exponha detalhes internos como número do trecho, tema ou score.
      
      REGRAS:
      1. Se os trechos abaixo responderem diretamente a pergunta: responda com base neles e cite o artigo. 
      Se os trechos NÃO responderem diretamente: ignore-os completamente e responda APENAS com "Esse tema ainda não está coberto pelos nossos materiais. 
      Mas você pode explorar os artigos do projeto em desmistifake.unisinos.br 😊". Não explique o que encontrou, não mencione os trechos, não tente aproximar.
      2. Nunca invente, extrapole ou complete com conhecimento próprio.
      3. Não diagnostique doenças nem prescreva medicamentos.
      4. Se a mensagem for uma saudação ou mensagem curta sem conteúdo claro, responda de forma breve e convide para uma pergunta sobre saúde.
      5. Confirmações como "ok", "entendi", "valeu" merecem no máximo uma frase curta. Pare por aí.
      6. Nunca faça mais de uma pergunta por resposta. Se quiser convidar para continuar, use apenas uma frase curta.
      
      TRECHOS DOS NOSSOS ARTIGOS:
      ${usefulContent.map((t, i) => `--- Trecho ${i + 1} ---\nArtigo: "${t.titulo}"\n${t.texto}`).join("\n\n")}`
      
            : `Você é o Desmistifake, assistente oficial do projeto Desmistifake Saúde da Unisinos.
      
      Nenhum artigo relevante foi encontrado para essa pergunta.

      TEMAS QUE O PROJETO COBRE (mas que podem ainda não ter artigo publicado):
      - [TEMA 1 — Saúde Mental]
      - [TEMA 2 — Saúde Materna-Infantil e Reprodutiva]
      - [TEMA 3 — Tecnologias em Saúde e Inovação]
      
      REGRAS:
      1. Se for uma saudação ou mensagem emocional (ex: medo, preocupação, gratidão): responda de forma humana, breve e acolhedora. Não use a mensagem padrão. Convide para uma pergunta sobre saúde se fizer sentido.
      2. Para qualquer outra pergunta: responda APENAS com "Esse tema ainda não está coberto pelos nossos materiais. Mas você pode explorar os artigos do projeto em desmistifake.unisinos.br 😊"
      3. Para qualquer outro tema fora do escopo: responda APENAS com "Esse tema ainda não está coberto pelos nossos materiais. Mas você pode explorar os artigos do projeto em desmistifake.unisinos.br 😊"`;

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
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