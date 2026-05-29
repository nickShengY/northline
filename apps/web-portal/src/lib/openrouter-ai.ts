/**
 * OpenRouter AI Service Integration with Structured Outputs
 *
 * Provides LLM-powered AI analysis for:
 * - Risk assessment enhancement
 * - Operational recommendations
 * - Safety analysis
 * - Catch optimization
 * - Ice condition analysis
 */

// Structured output schemas for different AI tasks
export interface RiskAssessmentSchema {
  vessel_mmsi: string;
  risk_score: number; // 0-100
  risk_level: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  primary_factors: string[];
  recommendations: string[];
  confidence: number; // 0-1
  analysis_timestamp: string;
}

export interface RecommendationSchema {
  category: "SAFETY" | "EFFICIENCY" | "COMPLIANCE" | "OPERATIONAL";
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  title: string;
  description: string;
  action_items: string[];
  expected_outcome: string;
  time_frame: string;
  confidence: number; // 0-1
}

export interface CatchOptimizationSchema {
  recommended_grids: Array<{
    grid_id: string;
    confidence: number;
    expected_catch_rate: number;
    reasoning: string;
  }>;
  current_conditions: {
    water_temperature: number;
    depth: number;
    weather_impact: string;
  };
  optimal_timing: {
    best_hours: string[];
    duration_hours: number;
  };
  risk_factors: string[];
}

export interface IceConditionSchema {
  ice_thickness_cm: number;
  ice_quality: "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | "DANGEROUS";
  safety_rating: number; // 1-10
  recommended_actions: string[];
  weather_impact: string;
  stability_factors: string[];
  last_updated: string;
}

export interface CollisionPredictionSchema {
  vessel_a: {
    mmsi: string;
    name: string;
  };
  vessel_b: {
    mmsi: string;
    name: string;
  };
  collision_probability: number; // 0-1
  time_to_closest_approach: number; // minutes
  closest_approach_distance: number; // nautical miles
  risk_level: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  recommended_actions: string[];
  confidence: number; // 0-1
}

class OpenRouterAIService {
  // Recommended models for structured outputs with fallback hierarchy
  private models = {
    primary: "openrouter/aurora-alpha", // Primary choice
    fallback1: "stepfun/step-3.5-flash:free", // First fallback
    fallback2: "anthropic/claude-opus-4.5", // Second fallback
    fallback3: "openai/gpt-oss-safeguard-20b:nitro", // Final fallback
    reasoning: "openrouter/aurora-alpha", // Default for complex reasoning
    fast: "stepfun/step-3.5-flash:free", // Fast and cost-effective
    analysis: "anthropic/claude-opus-4.5" // Great for data analysis
  };

  constructor() {}

  /**
   * Generic OpenRouter API call with structured outputs and model fallbacks
   */
  private async callOpenRouter<T>(
    messages: Array<{ role: string; content: string }>,
    schema: any,
    preferredModel?: string,
    temperature: number = 0.1
  ): Promise<T> {
    throw new Error("Direct browser OpenRouter calls are disabled. Use the Northline API AI endpoints.");

    // Define model fallback hierarchy
    const modelHierarchy = [
      preferredModel || this.models.primary,
      this.models.fallback1,
      this.models.fallback2,
      this.models.fallback3
    ];

    let lastError: Error | null = null;

    for (const model of modelHierarchy) {
      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": "Bearer disabled",
            "Content-Type": "application/json",
            "HTTP-Referer": window.location.origin,
            "X-Title": "Northline Fleet AI Analysis"
          },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens: 2000,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: schema.name || "response",
                strict: true,
                schema: schema
              }
            }
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenRouter API error with model ${model}: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json() as any;
        const content = data.choices[0]?.message?.content;

        if (!content) {
          throw new Error(`No content received from OpenRouter with model ${model}`);
        }

        console.log(`✅ Successfully used model: ${model} for ${schema.name || 'AI request'}`);
        return JSON.parse(content) as T;
      } catch (error) {
        console.warn(`⚠️ Model ${model} failed for ${schema.name || 'AI request'}, trying next fallback:`, error);
        lastError = error as Error;
        continue; // Try next model
      }
    }

    // All models failed
    throw lastError || new Error("All OpenRouter models failed");
  }

  /**
   * Enhanced risk assessment using LLM
   */
  async assessRisk(vesselData: any, weatherData: any, fishingZone?: any): Promise<RiskAssessmentSchema> {
    const schema = {
      name: "risk_assessment",
      type: "object",
      properties: {
        vessel_mmsi: { type: "string", description: "Vessel MMSI identifier" },
        risk_score: { type: "number", minimum: 0, maximum: 100, description: "Overall risk score 0-100" },
        risk_level: {
          type: "string",
          enum: ["LOW", "MODERATE", "HIGH", "CRITICAL"],
          description: "Risk level classification"
        },
        primary_factors: {
          type: "array",
          items: { type: "string" },
          description: "Main factors contributing to risk"
        },
        recommendations: {
          type: "array",
          items: { type: "string" },
          description: "Specific recommendations to mitigate risk"
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Confidence in the assessment 0-1"
        },
        analysis_timestamp: {
          type: "string",
          description: "ISO timestamp of analysis"
        }
      },
      required: ["vessel_mmsi", "risk_score", "risk_level", "primary_factors", "recommendations", "confidence", "analysis_timestamp"],
      additionalProperties: false
    };

    const messages = [
      {
        role: "system",
        content: `You are an expert maritime safety analyst specializing in fishing vessel risk assessment.
        Analyze the provided vessel and weather data to produce a comprehensive risk assessment.
        Consider factors like weather conditions, vessel behavior, fishing operations, and environmental hazards.
        Provide specific, actionable recommendations.`
      },
      {
        role: "user",
        content: `Please assess the risk for this vessel:

        Vessel Data: ${JSON.stringify(vesselData, null, 2)}
        Weather Data: ${JSON.stringify(weatherData, null, 2)}
        ${fishingZone ? `Fishing Zone: ${JSON.stringify(fishingZone, null, 2)}` : ''}

        Focus on maritime safety, weather impact, and operational risks specific to fishing vessels.`
      }
    ];

    return this.callOpenRouter<RiskAssessmentSchema>(messages, schema, this.models.reasoning);
  }

  /**
   * Generate operational recommendations using LLM
   */
  async getRecommendations(
    tripData: any,
    weatherData: any,
    mode: "OFFSHORE" | "ICE",
    fleetContext?: any
  ): Promise<RecommendationSchema[]> {
    const schema = {
      name: "recommendations",
      type: "array",
      items: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["SAFETY", "EFFICIENCY", "COMPLIANCE", "OPERATIONAL"],
            description: "Category of recommendation"
          },
          priority: {
            type: "string",
            enum: ["LOW", "MEDIUM", "HIGH", "URGENT"],
            description: "Priority level"
          },
          title: { type: "string", description: "Brief title of recommendation" },
          description: { type: "string", description: "Detailed description" },
          action_items: {
            type: "array",
            items: { type: "string" },
            description: "Specific action items"
          },
          expected_outcome: { type: "string", description: "Expected result if implemented" },
          time_frame: { type: "string", description: "When this should be implemented" },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Confidence in this recommendation"
          }
        },
        required: ["category", "priority", "title", "description", "action_items", "expected_outcome", "time_frame", "confidence"],
        additionalProperties: false
      }
    };

    const messages = [
      {
        role: "system",
        content: `You are an expert fishing operations consultant providing recommendations for ${mode} fishing operations.
        Focus on safety, efficiency, regulatory compliance, and operational excellence.
        Provide practical, actionable recommendations based on current conditions and fleet context.`
      },
      {
        role: "user",
        content: `Generate operational recommendations for this ${mode} fishing operation:

        Trip Data: ${JSON.stringify(tripData, null, 2)}
        Weather Data: ${JSON.stringify(weatherData, null, 2)}
        ${fleetContext ? `Fleet Context: ${JSON.stringify(fleetContext, null, 2)}` : ''}

        Consider:
        - Current weather and sea conditions
        - Operational efficiency opportunities
        - Safety considerations specific to ${mode} fishing
        - Regulatory compliance requirements
        - Best practices for the current situation`
      }
    ];

    return this.callOpenRouter<RecommendationSchema[]>(messages, schema, this.models.reasoning, 0.2);
  }

  /**
   * King crab catch optimization analysis
   */
  async optimizeCatch(
    currentLocation: any,
    weatherData: any,
    historicalData?: any
  ): Promise<CatchOptimizationSchema> {
    const schema = {
      name: "catch_optimization",
      type: "object",
      properties: {
        recommended_grids: {
          type: "array",
          items: {
            type: "object",
            properties: {
              grid_id: { type: "string", description: "Fishing grid identifier" },
              confidence: { type: "number", minimum: 0, maximum: 1, description: "Confidence level" },
              expected_catch_rate: { type: "number", description: "Expected catch rate (kg/hour)" },
              reasoning: { type: "string", description: "Why this grid is recommended" }
            },
            required: ["grid_id", "confidence", "expected_catch_rate", "reasoning"],
            additionalProperties: false
          },
          description: "Recommended fishing grids"
        },
        current_conditions: {
          type: "object",
          properties: {
            water_temperature: { type: "number", description: "Water temperature in Celsius" },
            depth: { type: "number", description: "Current depth in meters" },
            weather_impact: { type: "string", description: "How current weather affects fishing" }
          },
          required: ["water_temperature", "depth", "weather_impact"],
          additionalProperties: false
        },
        optimal_timing: {
          type: "object",
          properties: {
            best_hours: {
              type: "array",
              items: { type: "string" },
              description: "Best fishing hours"
            },
            duration_hours: { type: "number", description: "Recommended fishing duration" }
          },
          required: ["best_hours", "duration_hours"],
          additionalProperties: false
        },
        risk_factors: {
          type: "array",
          items: { type: "string" },
          description: "Risk factors to consider"
        }
      },
      required: ["recommended_grids", "current_conditions", "optimal_timing", "risk_factors"],
      additionalProperties: false
    };

    const messages = [
      {
        role: "system",
        content: "You are an expert king crab fishing analyst with deep knowledge of Bering Sea fishing patterns, oceanography, and crab behavior. Provide data-driven recommendations for optimal catch rates while considering safety and regulations."
      },
      {
        role: "user",
        content: `Analyze catch optimization for king crab fishing:

        Current Location: ${JSON.stringify(currentLocation, null, 2)}
        Weather Data: ${JSON.stringify(weatherData, null, 2)}
        ${historicalData ? `Historical Data: ${JSON.stringify(historicalData, null, 2)}` : ''}

        Consider:
        - King crab migration patterns and habitat preferences
        - Optimal water temperature and depth ranges
        - Weather impacts on crab behavior and fishing safety
        - Historical catch patterns in the area
        - Regulatory considerations for king crab fishing`
      }
    ];

    return this.callOpenRouter<CatchOptimizationSchema>(messages, schema, this.models.analysis, 0.1);
  }

  /**
   * Ice condition analysis for ice fishing
   */
  async analyzeIceConditions(
    location: any,
    weatherData: any,
    recentMeasurements?: any
  ): Promise<IceConditionSchema> {
    const schema = {
      name: "ice_condition_analysis",
      type: "object",
      properties: {
        ice_thickness_cm: { type: "number", description: "Ice thickness in centimeters" },
        ice_quality: {
          type: "string",
          enum: ["EXCELLENT", "GOOD", "FAIR", "POOR", "DANGEROUS"],
          description: "Overall ice quality assessment"
        },
        safety_rating: {
          type: "number",
          minimum: 1,
          maximum: 10,
          description: "Safety rating from 1 (dangerous) to 10 (excellent)"
        },
        recommended_actions: {
          type: "array",
          items: { type: "string" },
          description: "Safety recommendations"
        },
        weather_impact: { type: "string", description: "How current weather affects ice conditions" },
        stability_factors: {
          type: "array",
          items: { type: "string" },
          description: "Factors affecting ice stability"
        },
        last_updated: { type: "string", description: "Analysis timestamp" }
      },
      required: ["ice_thickness_cm", "ice_quality", "safety_rating", "recommended_actions", "weather_impact", "stability_factors", "last_updated"],
      additionalProperties: false
    };

    const messages = [
      {
        role: "system",
        content: "You are an expert ice safety analyst specializing in ice fishing operations. Analyze ice conditions for safety and fishing viability. Prioritize safety above all else."
      },
      {
        role: "user",
        content: `Analyze ice conditions for ice fishing safety:

        Location: ${JSON.stringify(location, null, 2)}
        Weather Data: ${JSON.stringify(weatherData, null, 2)}
        ${recentMeasurements ? `Recent Ice Measurements: ${JSON.stringify(recentMeasurements, null, 2)}` : ''}

        Consider:
        - Ice thickness and structural integrity
        - Temperature trends and freezing conditions
        - Wind and weather impacts on ice stability
        - Load bearing capacity for fishing operations
        - Safety factors specific to ice fishing`
      }
    ];

    return this.callOpenRouter<IceConditionSchema>(messages, schema, this.models.reasoning, 0.1);
  }

  /**
   * Enhanced collision prediction using LLM
   */
  async predictCollision(
    vesselA: any,
    vesselB: any,
    environmentalContext: any
  ): Promise<CollisionPredictionSchema> {
    const schema = {
      name: "collision_prediction",
      type: "object",
      properties: {
        vessel_a: {
          type: "object",
          properties: {
            mmsi: { type: "string" },
            name: { type: "string" }
          },
          required: ["mmsi", "name"],
          additionalProperties: false
        },
        vessel_b: {
          type: "object",
          properties: {
            mmsi: { type: "string" },
            name: { type: "string" }
          },
          required: ["mmsi", "name"],
          additionalProperties: false
        },
        collision_probability: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Probability of collision 0-1"
        },
        time_to_closest_approach: {
          type: "number",
          description: "Minutes until closest approach"
        },
        closest_approach_distance: {
          type: "number",
          description: "Distance at closest approach in nautical miles"
        },
        risk_level: {
          type: "string",
          enum: ["LOW", "MODERATE", "HIGH", "CRITICAL"],
          description: "Risk level classification"
        },
        recommended_actions: {
          type: "array",
          items: { type: "string" },
          description: "Recommended actions to avoid collision"
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Confidence in prediction"
        }
      },
      required: ["vessel_a", "vessel_b", "collision_probability", "time_to_closest_approach", "closest_approach_distance", "risk_level", "recommended_actions", "confidence"],
      additionalProperties: false
    };

    const messages = [
      {
        role: "system",
        content: "You are an expert maritime collision analyst with deep knowledge of vessel navigation, COLREGs, and collision avoidance. Provide accurate collision risk assessments with specific recommendations."
      },
      {
        role: "user",
        content: `Predict collision risk between two vessels:

        Vessel A: ${JSON.stringify(vesselA, null, 2)}
        Vessel B: ${JSON.stringify(vesselB, null, 2)}
        Environmental Context: ${JSON.stringify(environmentalContext, null, 2)}

        Consider:
        - Current courses, speeds, and headings
        - Closest Point of Approach (CPA) calculations
        - COLREGs navigation rules
        - Weather and sea state impacts
        - Time available for evasive action
        - Recommended collision avoidance maneuvers`
      }
    ];

    return this.callOpenRouter<CollisionPredictionSchema>(messages, schema, this.models.analysis, 0.05);
  }

  /**
   * Health check for OpenRouter service
   */
  async healthCheck(): Promise<{ status: string; models_available: boolean; latency: number }> {
    return { status: "server_proxy_required", models_available: false, latency: 0 };

    const start = Date.now();
    try {
      // Simple test call
      await this.callOpenRouter(
        [{ role: "user", content: "Respond with a simple JSON object: {\"test\": true}" }],
        {
          name: "test",
          type: "object",
          properties: { test: { type: "boolean" } },
          required: ["test"],
          additionalProperties: false
        },
        this.models.fast,
        0
      );

      return {
        status: "healthy",
        models_available: true,
        latency: Date.now() - start
      };
    } catch (error) {
      return {
        status: "error",
        models_available: false,
        latency: Date.now() - start
      };
    }
  }
}

// Export singleton instance
export const openRouterAI = new OpenRouterAIService();
