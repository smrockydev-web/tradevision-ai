import { GoogleGenAI, Type, Modality } from "@google/genai";

let aiInstance: GoogleGenAI | null = null;

function getAI() {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined. Please check your environment variables.");
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

export interface TradeSignal {
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  confidence: number;
  reasoning: string;
  indicators?: {
    rsi: string;
    trend: string;
    supportResistance: string;
    patterns: string;
  };
  timeframe: string;
  expiry: string;
  predictions?: {
    shortTerm: 'UP' | 'DOWN' | 'NEUTRAL'; // 5-30 seconds
    mediumTerm: 'UP' | 'DOWN' | 'NEUTRAL'; // 5 minutes
    longTerm: 'UP' | 'DOWN' | 'NEUTRAL'; // 10 minutes
  };
  timestamp?: Date;
}

export async function analyzeTradingScreen(base64Image: string, highPrecision: boolean = false): Promise<TradeSignal> {
  try {
    const ai = getAI();
    const modelName = highPrecision ? "gemini-3.1-pro-preview" : "gemini-flash-latest";
    
    const response = await ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image,
            },
          },
          {
            text: `You are an elite binary options trading algorithm specialized in comprehensive technical analysis for the Quotex platform.
            
            ${highPrecision ? "HIGH PRECISION MODE ACTIVE: Use your maximum reasoning power to ensure 100% accuracy. Analyze every pixel of the chart, indicators, and price action." : ""}

            EXTENDED ANALYSIS REQUIREMENTS:
            1. CHART DATA: Analyze price action, candlestick formations, support/resistance levels, trend lines, and channels.
            2. TECHNICAL INDICATORS: Visually identify and interpret RSI, MACD, Moving Averages (SMA/EMA), Bollinger Bands, and Stochastic Oscillators if visible.
            3. PATTERN RECOGNITION: Detect chart patterns (Head & Shoulders, Triangles, Flags) and candlestick patterns (Doji, Hammer, Engulfing).
            4. MARKET CONTEXT: Evaluate current asset price, trend strength, and potential breakout confirmations.
            
            PREDICTION GOAL:
            - Predict the price direction (UP or DOWN) for a 1-MINUTE EXPIRY.
            - Provide a confidence score (0-100%).
            
            CRITERIA:
            - Provide your best prediction (UP or DOWN) based on the current chart data.
            - Focus on the most likely direction for a 1-minute expiry.
            - Even if confidence is not 100%, give the most probable direction.
            - STRICTLY return "UP" or "DOWN" as the direction.
            ${highPrecision ? "- In High Precision Mode, double-check all signals against multiple timeframes and indicators before confirming." : ""}
            
            Return JSON:
            {
              "direction": "UP" | "DOWN" | "NEUTRAL",
              "confidence": number,
              "reasoning": "Detailed technical breakdown including indicators and patterns found",
              "indicators": {
                "rsi": "Overbought" | "Oversold" | "Neutral" | "Not Visible",
                "trend": "Strong Bullish" | "Weak Bullish" | "Strong Bearish" | "Weak Bearish" | "Sideways",
                "supportResistance": "Near Support" | "Near Resistance" | "In Channel" | "Breakout",
                "patterns": "List any detected patterns"
              },
              "timeframe": "Detected chart timeframe",
              "expiry": "1 Minute",
              "predictions": {
                "shortTerm": "UP" | "DOWN" | "NEUTRAL",
                "mediumTerm": "UP" | "DOWN" | "NEUTRAL",
                "longTerm": "UP" | "DOWN" | "NEUTRAL"
              }
            }`,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            direction: { type: Type.STRING, enum: ["UP", "DOWN", "NEUTRAL"] },
            confidence: { type: Type.NUMBER },
            reasoning: { type: Type.STRING },
            indicators: {
              type: Type.OBJECT,
              properties: {
                rsi: { type: Type.STRING },
                trend: { type: Type.STRING },
                supportResistance: { type: Type.STRING },
                patterns: { type: Type.STRING }
              },
              required: ["rsi", "trend", "supportResistance", "patterns"]
            },
            timeframe: { type: Type.STRING },
            expiry: { type: Type.STRING },
            predictions: {
              type: Type.OBJECT,
              properties: {
                shortTerm: { type: Type.STRING, enum: ["UP", "DOWN", "NEUTRAL"] },
                mediumTerm: { type: Type.STRING, enum: ["UP", "DOWN", "NEUTRAL"] },
                longTerm: { type: Type.STRING, enum: ["UP", "DOWN", "NEUTRAL"] },
              },
              required: ["shortTerm", "mediumTerm", "longTerm"],
            },
          },
          required: ["direction", "confidence", "reasoning", "indicators", "timeframe", "expiry", "predictions"],
        },
      },
    });

    const result = JSON.parse(response.text || "{}");
    return result as TradeSignal;
  } catch (error) {
    console.error("Error analyzing screen:", error);
    return {
      direction: 'NEUTRAL',
      confidence: 0,
      reasoning: "Failed to analyze the screen. Please ensure the chart is clearly visible.",
      timeframe: "Unknown",
      expiry: "N/A"
    };
  }
}

export async function generateSignalVoiceover(signal: TradeSignal): Promise<string | null> {
  if (signal.direction === 'NEUTRAL') return null;

  try {
    const ai = getAI();
    const directionText = signal.direction === 'UP' ? 'উপরে (UP)' : 'নিচে (DOWN)';
    const confidenceText = `${signal.confidence} শতাংশ নিশ্চিত।`;
    
    const prompt = `Say in native Bengali (বাংলা): "নতুন ১ মিনিটের ট্রেড সিগন্যাল পাওয়া গেছে। মার্কেট এখন ${directionText} যাবে। আমাদের ${confidenceText}"`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;
  } catch (error) {
    console.error("Error generating voiceover:", error);
    return null;
  }
}

export interface TradeResult {
  status: 'WIN' | 'LOSS' | 'UNKNOWN';
  cause?: string;
}

export async function checkTradeResult(base64Image: string, originalSignal: TradeSignal): Promise<TradeResult> {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-flash-latest",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image,
            },
          },
          {
            text: `You analyzed a Quotex trading chart earlier and gave this signal: ${originalSignal.direction} with ${originalSignal.confidence}% confidence. 
            
            Now, look at this current screenshot of the Quotex portal. 
            1. Check the current price relative to the entry point on the chart.
            2. Look at the "Trades" history panel on the right side of the screen.
            3. Determine if the trade was a WIN or a LOSS.
            4. If it was a LOSS, explain the technical reason (e.g., "Price reversed at resistance", "Volatility spike", "Trend continuation failed").
            
            Return JSON:
            {
              "status": "WIN" | "LOSS" | "UNKNOWN",
              "cause": "Brief explanation in English if LOSS, otherwise empty"
            }`,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            status: { type: Type.STRING, enum: ["WIN", "LOSS", "UNKNOWN"] },
            cause: { type: Type.STRING },
          },
          required: ["status", "cause"],
        },
      },
    });

    const result = JSON.parse(response.text || "{}");
    return result as TradeResult;
  } catch (error) {
    console.error("Error checking result:", error);
    return { status: 'UNKNOWN' };
  }
}

export async function generateResultVoiceover(result: TradeResult): Promise<string | null> {
  try {
    const ai = getAI();
    let prompt = "";
    if (result.status === 'WIN') {
      prompt = 'Say enthusiastically in native Bengali (বাংলা): "অভিনন্দন! আপনি ট্রেডটি জিতেছেন। চমৎকার কাজ করেছেন।"';
    } else if (result.status === 'LOSS') {
      prompt = `Say sympathetically in native Bengali (বাংলা): "দুঃখিত, ট্রেডটি লস হয়েছে। কারণ ছিল: ${result.cause}। ধৈর্য ধরুন এবং পরবর্তী সুযোগের জন্য অপেক্ষা করুন।"`;
    } else {
      return null;
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;
  } catch (error) {
    console.error("Error generating result voiceover:", error);
    return null;
  }
}
