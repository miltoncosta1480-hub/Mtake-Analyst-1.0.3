
import { GoogleGenAI, Type } from "@google/genai";
import { MarketSnapshot, AnalysisResult, SignalType, NewsSource, PreMarketAnalysis } from '../types';

// --- FALLBACK: ANÁLISE MATEMÁTICA (CASO A IA FALHE) ---
function fallbackHeuristicAnalysis(snapshot: MarketSnapshot, newsSummary: string): AnalysisResult {
  let score = 0;
  const reasons: string[] = [];
  const positive: string[] = [];
  const negative: string[] = [];

  // Pesos para decisão
  const assets = snapshot.assets;
  
  // 1. EWZ (Peso 3 - O mais importante)
  const ewz = assets.find(a => a.symbol === 'EWZ');
  if (ewz) {
    if (ewz.changePercent > 0.5) { score += 3; positive.push(`EWZ subindo forte (${ewz.changePercent}%)`); }
    else if (ewz.changePercent < -0.5) { score -= 3; negative.push(`EWZ caindo forte (${ewz.changePercent}%)`); }
  }

  // 2. S&P 500 / SPY (Peso 2)
  const spy = assets.find(a => a.symbol === 'SPY');
  if (spy) {
    if (spy.changePercent > 0.3) { score += 2; positive.push("S&P 500 em alta"); }
    else if (spy.changePercent < -0.3) { score -= 2; negative.push("S&P 500 em baixa"); }
  }

  // 3. Dólar & DXY (Peso Inverso 2)
  const usd = assets.find(a => a.symbol === 'USD');
  const dxy = assets.find(a => a.symbol === 'UUP'); // UUP é o proxy do DXY

  // Análise Dólar Local
  if (usd) {
    if (usd.changePercent < -0.2) { score += 1.5; positive.push("Dólar (BRL) perdendo força"); }
    else if (usd.changePercent > 0.2) { score -= 1.5; negative.push("Dólar (BRL) ganhando força"); }
  }

  // Análise DXY Global (Risk-Off)
  if (dxy) {
    if (dxy.changePercent < -0.1) { score += 1.5; positive.push("DXY (Global) em queda (Risk-On)"); }
    else if (dxy.changePercent > 0.1) { score -= 1.5; negative.push("DXY (Global) em alta (Risk-Off)"); }
  }

  // Decisão
  let signal = SignalType.NEUTRO;
  let confidence = 50;
  let outlook = "Lateralidade (Aguardar)";
  let entry = "Aguardar rompimento";
  let takeProfit = "N/A";
  let stopLoss = "N/A";

  if (score >= 3) {
    signal = SignalType.COMPRA;
    confidence = Math.min(60 + (score * 5), 95);
    outlook = "Tendência de Alta";
    entry = "Comprar Pullback";
    takeProfit = "+150 a +300 pts";
    stopLoss = "-150 pts";
  } else if (score <= -3) {
    signal = SignalType.VENDA;
    confidence = Math.min(60 + (Math.abs(score) * 5), 95);
    outlook = "Tendência de Baixa";
    entry = "Vender Repique";
    takeProfit = "+150 a +300 pts";
    stopLoss = "-150 pts";
  }

  return {
    signal,
    confidence,
    reasoning: "⚠️ MODO DE CONTINGÊNCIA (IA Indisponível): Sinal gerado por algoritmo quantitativo baseado no fluxo de EWZ, SPY, Dólar e DXY.",
    technicalOutlook: outlook,
    entryZone: entry,
    takeProfit,
    stopLoss,
    positiveFactors: positive.length > 0 ? positive : ["Fluxo comprador leve"],
    negativeFactors: negative.length > 0 ? negative : ["Fluxo vendedor leve"],
    newsSummary: newsSummary || "Não foi possível carregar notícias detalhadas no modo offline.",
    newsSources: [],
    timestamp: new Date().toISOString(),
    provider: 'FALLBACK'
  };
}

// Passo 1: Buscar notícias (Google Grounding)
async function fetchMarketNews(ai: GoogleGenAI): Promise<{ summary: string; sources: NewsSource[] }> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `
        Pesquise no site investing.com e principais portais financeiros do Brasil as notícias MAIS RECENTES (últimas horas) sobre:
        1. "Ibovespa hoje notícias" ou "Bolsa de Valores hoje"
        2. "Dólar Futuro (WDO) tendência hoje"
        3. "Petrobras e Vale notícias hoje"
        4. "Cenário Fiscal Brasil hoje" e "Campos Neto / Haddad hoje"

        Identifique fatos relevantes que podem impactar o WINFUT agora (Payroll, Copom, falas de políticos, guerras).
        Seja breve e direto.
      `,
      config: {
        tools: [{ googleSearch: {} }],
      }
    });

    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources: NewsSource[] = chunks
      .filter(c => c.web?.uri && c.web?.title)
      .map(c => ({
        title: c.web!.title!,
        uri: c.web!.uri!
      }))
      .filter((v, i, a) => a.findIndex(t => t.uri === v.uri) === i)
      .slice(0, 4);

    return {
      summary: response.text || "Sem notícias relevantes encontradas no momento.",
      sources
    };

  } catch (error) {
    console.warn("Aviso: Busca de notícias indisponível ou limitada.", error);
    return { 
      summary: "Notícias indisponíveis (Modo Numérico Puro).", 
      sources: [] 
    };
  }
}

// Passo 2: Analisar Dados + Notícias + Imagem (Opcional)
export const analyzeMarket = async (snapshot: MarketSnapshot, imageBase64?: string): Promise<AnalysisResult> => {
  let newsSummary = "Aguardando análise...";
  let newsSources: NewsSource[] = [];

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    // 1. Busca notícias
    const newsData = await fetchMarketNews(ai);
    newsSummary = newsData.summary;
    newsSources = newsData.sources;

    // 2. Prepara dados numéricos
    const categories: Record<string, string[]> = {};
    snapshot.assets.forEach(a => {
      if (!categories[a.category]) categories[a.category] = [];
      const change = typeof a.changePercent === 'number' ? a.changePercent : 0;
      const sign = change > 0 ? '+' : '';
      categories[a.category].push(`${a.symbol}: ${sign}${change}%`);
    });

    const marketDataSummary = Object.entries(categories)
      .map(([cat, items]) => `### ${cat}:\n${items.join(', ')}`)
      .join('\n\n');

    // 3. Monta o Prompt e as Partes (Texto + Imagem)
    const promptText = `
      Atue como um Trader Institucional Sênior e Estrategista Global especializado em WINFUT (Índice Futuro Brasil).
      
      ## PARTE 1: CONTEXTO DE NOTÍCIAS (WEB)
      "${newsSummary}"

      ## PARTE 2: DADOS DE MERCADO EM TEMPO REAL
      ${marketDataSummary}

      **ATENÇÃO CRÍTICA AO DXY (Use o proxy UUP se disponível nos dados):**
      - Compare a variação do USD/BRL (Interno) com o DXY/UUP (Global).
      - Se DXY sobe e USDBRL sobe = Aversão Global a Risco (Venda WINFUT).
      - Se DXY cai mas USDBRL sobe = Risco Fiscal Brasileiro/Ruído Interno (Venda WINFUT com mais força).
      - Se DXY cai e USDBRL cai = Fluxo Global Positivo (Compra WINFUT).

      ${imageBase64 ? '## PARTE 3: ANÁLISE VISUAL DO GRÁFICO (IMAGEM FORNECIDA)\nAnalise o gráfico fornecido. Identifique a tendência visual, padrões de candle e níveis de suporte/resistência.' : '## PARTE 3: ANÁLISE TÉCNICA\nO usuário não forneceu gráfico. Estime níveis técnicos baseados na volatilidade implícita do mercado atual.'}
      
      SUA TAREFA:
      1. Gere um sinal (COMPRA, VENDA, NEUTRO).
      2. Defina uma "Technical Outlook" CURTA (ex: "Bandeira de Baixa no 5min" ou "Reversão em Suporte").
      3. Defina um SETUP DE OPERAÇÃO claro com 3 pontas:
         - Zona de Entrada (Onde entrar).
         - Stop Loss (Onde sair se der errado - Proteção).
         - Take Profit (Alvo de lucro realista).
      
      Use a imagem (se houver) para calibrar o Stop Loss atrás de suportes/resistências visuais.
    `;

    const parts: any[] = [{ text: promptText }];
    
    // Adiciona a imagem se houver
    if (imageBase64) {
      const base64Data = imageBase64.split(',')[1] || imageBase64;
      parts.push({
        inlineData: {
          mimeType: "image/png", 
          data: base64Data
        }
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: { parts: parts },
      config: {
        thinkingConfig: { thinkingBudget: 2048 }, 
        systemInstruction: "Você é uma IA de trading. Seja extremamente objetivo. Defina Stops e Alvos numéricos ou descritivos claros.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            signal: { type: Type.STRING, enum: [SignalType.COMPRA, SignalType.VENDA, SignalType.NEUTRO] },
            confidence: { type: Type.INTEGER },
            reasoning: { type: Type.STRING },
            technicalOutlook: { type: Type.STRING, description: "Resumo técnico muito curto, ex: 'Rompimento de Pivô'" },
            entryZone: { type: Type.STRING, description: "Preço ou condição de entrada" },
            stopLoss: { type: Type.STRING, description: "Preço ou condição de stop" },
            takeProfit: { type: Type.STRING, description: "Preço ou alvo de ganho" },
            positiveFactors: { type: Type.ARRAY, items: { type: Type.STRING } },
            negativeFactors: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["signal", "confidence", "reasoning", "technicalOutlook", "entryZone", "stopLoss", "takeProfit", "positiveFactors", "negativeFactors"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) throw new Error("Sem resposta da IA");

    const analysis = JSON.parse(resultText);

    return {
      ...analysis,
      newsSummary,
      newsSources,
      timestamp: new Date().toISOString(),
      provider: 'GEMINI'
    } as AnalysisResult;

  } catch (error) {
    console.warn("Falha na IA, ativando Protocolo de Contingência (Fallback):", error);
    return fallbackHeuristicAnalysis(snapshot, newsSummary);
  }
};

// --- ANÁLISE PRÉ-MERCADO (MORNING CALL PLAYBOOK) ---
export const generatePreMarketReport = async (snapshot: MarketSnapshot): Promise<PreMarketAnalysis> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // 1. Pesquisa Web Específica (Pilar 1, 2 e 4 do Playbook)
  const newsResponse = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: `
      Pesquise informações ATUALIZADAS e CRÍTICAS para o Morning Call da B3 (Índice Futuro) de hoje:
      
      1. AGENDA ECONÔMICA DE HOJE:
         - Payroll? FOMC? PIB? Discurso do Powell/Haddad/Campos Neto?
         - Horários exatos (09:00, 09:30, 10:30, 11:00).
      
      2. FLUXO ESTRANGEIRO NA B3 (Ontem):
         - "Saldo de estrangeiros na B3 ontem".
         - "Estrangeiros compraram ou venderam índice futuro ontem?".
         - Tente achar o saldo (positivo ou negativo) do pregão anterior.

      3. CONTEXTO DE ONTEM (WINFUT/IBOV):
         - Como o índice fechou ontem? (Alta/Baixa).
         - Onde foram as máximas e mínimas?
         - Regiões de briga institucional citadas em notícias.
    `,
    config: { tools: [{ googleSearch: {} }] }
  });

  const context = newsResponse.text || "Sem notícias detalhadas disponíveis.";

  // 2. Prepara dados numéricos dos 41 Ativos (Pilar 3: Correlacionados)
  const categories: Record<string, string[]> = {};
  snapshot.assets.forEach(a => {
    if (!categories[a.category]) categories[a.category] = [];
    const change = typeof a.changePercent === 'number' ? a.changePercent : 0;
    const sign = change > 0 ? '+' : '';
    categories[a.category].push(`${a.symbol}: ${sign}${change}%`);
  });

  const fullMarketData = Object.entries(categories)
    .map(([cat, items]) => `### ${cat}:\n${items.join(', ')}`)
    .join('\n\n');

  // 3. Prompt do Estrategista (Seguindo o Playbook do Usuário)
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: `
      Você é um Estrategista de Mercado Institucional. Crie um "Morning Call" para traders de WINFUT baseado neste Playbook de 5 pontos:

      CONTEXTO PESQUISADO (WEB):
      ${context}

      DADOS DE AGORA (CORRELACIONADOS):
      ${fullMarketData}

      ANÁLISE OBRIGATÓRIA:

      1. **Agenda Econômica & Volatilidade:**
         - Liste os horários CRÍTICOS (09:00, 09:30, 10:30, 11:00).
         - Crie alertas como "Ficar fora 09:28-09:33".

      2. **Estrangeiros e Fluxo:**
         - Baseado na pesquisa, qual a posição dos gringos ontem? (Compraram ou venderam?).
         - Se não achar o dado exato, infira pelo fechamento de ontem e do EWZ de ontem.

      3. **Correlacionados (Snapshot Agora):**
         - Analise S&P Futuro (SPY), Nasdaq (QQQ), DXY (UUP) e EWZ.
         - O mundo está "Risk-On" (Comprando) ou "Risk-Off" (Vendendo)?

      4. **Contexto de Ontem:**
         - Onde o mercado trabalhou ontem? Fechou perto da máxima ou mínima?
      
      Gere um relatório JSON estrito.
    `,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          globalSentiment: { type: Type.STRING, enum: ['BULLISH', 'BEARISH', 'MIXED', 'NEUTRAL'] },
          openingBias: { type: Type.STRING, description: "Viés de abertura (Gap) e Sentimento" },
          
          volatilitySchedule: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                time: { type: Type.STRING },
                event: { type: Type.STRING },
                impact: { type: Type.STRING, enum: ['ALTO', 'MÉDIO', 'BAIXO'] },
                action: { type: Type.STRING, description: "Ex: Ficar fora" }
              }
            },
            description: "Horários de perigo e notícias"
          },

          foreignFlow: { type: Type.STRING, description: "Análise do fluxo gringo e fechamento de ontem" },
          
          correlations: {
            type: Type.OBJECT,
            properties: {
              sp500: { type: Type.STRING, description: "Resumo SPY/Futuros" },
              dxy: { type: Type.STRING, description: "Resumo Dólar Global" },
              ewz: { type: Type.STRING, description: "Resumo Brasil ETF" },
              treasuries: { type: Type.STRING, description: "Resumo Juros EUA" }
            }
          },

          yesterdayContext: { type: Type.STRING, description: "Resumo técnico do dia anterior" },
          strategyPlan: { type: Type.STRING, description: "Conclusão final do plano" }
        },
        required: ["globalSentiment", "openingBias", "volatilitySchedule", "foreignFlow", "correlations", "yesterdayContext", "strategyPlan"]
      }
    }
  });

  const result = JSON.parse(response.text || "{}");
  return { ...result, timestamp: new Date().toISOString() };
};
