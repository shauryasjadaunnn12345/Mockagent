export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      logs: {
        Row: {
          created_at: string
          api_key_id: string | null
          workspace_id: string
          error_details: Json | null
          id: string
          latency_ms: number
          payload: Json
          response_body: Json | null
          status: string
          scenario_name: string | null
          scenario_index: number | null
          scenario_step: number | null
          run_id: string | null
          tool_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          api_key_id?: string | null
          workspace_id: string
          error_details?: Json | null
          id?: string
          latency_ms?: number
          payload?: Json
          response_body?: Json | null
          status: string
          scenario_name?: string | null
          scenario_index?: number | null
          scenario_step?: number | null
          run_id?: string | null
          tool_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          api_key_id?: string | null
          workspace_id?: string
          error_details?: Json | null
          id?: string
          latency_ms?: number
          payload?: Json
          response_body?: Json | null
          status?: string
          scenario_name?: string | null
          scenario_index?: number | null
          scenario_step?: number | null
          run_id?: string | null
          tool_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "logs_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "tool_stats"
            referencedColumns: ["tool_id"]
          },
          {
            foreignKeyName: "logs_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "tools"
            referencedColumns: ["id"]
          },
        ]
      }
      tools: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          json_schema: Json
          mock_response: Json
          name: string
          require_api_key: boolean
          scenarios: Json
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          json_schema?: Json
          mock_response?: Json
          name: string
          require_api_key?: boolean
          scenarios?: Json
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          json_schema?: Json
          mock_response?: Json
          name?: string
          require_api_key?: boolean
          scenarios?: Json
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          key_prefix: string
          monthly_limit: number
          name: string
          revoked_at: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          key_prefix: string
          monthly_limit?: number
          name: string
          revoked_at?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          monthly_limit?: number
          name?: string
          revoked_at?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      api_key_usage: {
        Row: { api_key_id: string; calls_used: number; usage_month: string }
        Insert: { api_key_id: string; calls_used?: number; usage_month: string }
        Update: { api_key_id?: string; calls_used?: number; usage_month?: string }
        Relationships: []
      }
      workspace_usage: {
        Row: { calls_used: number; usage_month: string; workspace_id: string }
        Insert: { calls_used?: number; usage_month: string; workspace_id: string }
        Update: { calls_used?: number; usage_month?: string; workspace_id?: string }
        Relationships: []
      }
      dodo_webhook_events: {
        Row: { event_type: string; processed_at: string; webhook_id: string }
        Insert: { event_type: string; processed_at?: string; webhook_id: string }
        Update: { event_type?: string; processed_at?: string; webhook_id?: string }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          current_workspace_id: string | null
          log_retention_days: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_workspace_id?: string | null
          log_retention_days?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_workspace_id?: string | null
          log_retention_days?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string
          current_period_end: string | null
          id: string
          log_retention_days: number
          name: string
          plan: string
          dodo_customer_id: string | null
          dodo_environment: string | null
          dodo_subscription_id: string | null
          subscription_status: string
        }
        Insert: {
          created_at?: string
          created_by: string
          current_period_end?: string | null
          id?: string
          log_retention_days?: number
          name: string
          plan?: string
          dodo_customer_id?: string | null
          dodo_environment?: string | null
          dodo_subscription_id?: string | null
          subscription_status?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          current_period_end?: string | null
          id?: string
          log_retention_days?: number
          name?: string
          plan?: string
          dodo_customer_id?: string | null
          dodo_environment?: string | null
          dodo_subscription_id?: string | null
          subscription_status?: string
        }
        Relationships: []
      }
      workspace_members: {
        Row: {
          joined_at: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          joined_at?: string
          role: string
          user_id: string
          workspace_id: string
        }
        Update: {
          joined_at?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      daily_usage: {
        Row: {
          average_latency_ms: number | null
          day: string | null
          schema_violations: number | null
          successful_calls: number | null
          total_calls: number | null
          user_id: string | null
          workspace_id: string | null
        }
        Relationships: []
      }
      tool_stats: {
        Row: {
          last_called_at: string | null
          name: string | null
          schema_violations: number | null
          successful_calls: number | null
          tool_id: string | null
          total_calls: number | null
          user_id: string | null
          workspace_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      consume_gateway_call: {
        Args: { target_api_key_id?: string | null; target_workspace_id: string }
        Returns: number
      }
      delete_expired_logs: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      list_workspace_members: {
        Args: { target_workspace_id: string }
        Returns: { email: string | null; role: string; user_id: string }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

export type ExecutionStatus = "SUCCESS" | "SCHEMA_VIOLATION";
export type Tool = Tables<"tools">;
export type ToolInsert = TablesInsert<"tools">;
export type LogEntry = Tables<"logs">;
export type ToolStats = Tables<"tool_stats">;
