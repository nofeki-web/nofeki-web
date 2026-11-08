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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      budget_categories: {
        Row: {
          budget_id: string
          category_name: string
          created_at: string
          id: string
          planned_amount: number
          user_id: string
        }
        Insert: {
          budget_id: string
          category_name: string
          created_at?: string
          id?: string
          planned_amount: number
          user_id: string
        }
        Update: {
          budget_id?: string
          category_name?: string
          created_at?: string
          id?: string
          planned_amount?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_categories_budget_owner_fk"
            columns: ["budget_id", "user_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      budgets: {
        Row: {
          created_at: string
          expense_limit: number | null
          id: string
          income_amount: number | null
          mode: string
          period_month: string
          savings_target: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expense_limit?: number | null
          id?: string
          income_amount?: number | null
          mode: string
          period_month: string
          savings_target?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expense_limit?: number | null
          id?: string
          income_amount?: number | null
          mode?: string
          period_month?: string
          savings_target?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      financial_profiles: {
        Row: {
          additional_income_monthly: number
          has_additional_income: boolean | null
          income_frequency: string | null
          income_stability: string | null
          net_income_amount: number | null
          onboarding_status: string
          onboarding_step: number
          updated_at: string
          user_id: string
        }
        Insert: {
          additional_income_monthly?: number
          has_additional_income?: boolean | null
          income_frequency?: string | null
          income_stability?: string | null
          net_income_amount?: number | null
          onboarding_status?: string
          onboarding_step?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          additional_income_monthly?: number
          has_additional_income?: boolean | null
          income_frequency?: string | null
          income_stability?: string | null
          net_income_amount?: number | null
          onboarding_status?: string
          onboarding_step?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gastos: {
        Row: {
          amount: number
          category: string
          created_at: string
          description: string
          expense_date: string
          expense_type: string
          id: string
          idempotency_key: string | null
          note: string | null
          payment_method: string | null
          source: string
          user_id: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          description: string
          expense_date?: string
          expense_type: string
          id?: string
          idempotency_key?: string | null
          note?: string | null
          payment_method?: string | null
          source?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          description?: string
          expense_date?: string
          expense_type?: string
          id?: string
          idempotency_key?: string | null
          note?: string | null
          payment_method?: string | null
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      income_transactions: {
        Row: {
          amount: number
          concept: string
          created_at: string
          id: string
          income_date: string
          note: string | null
          source: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          concept: string
          created_at?: string
          id?: string
          income_date?: string
          note?: string | null
          source?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          concept?: string
          created_at?: string
          id?: string
          income_date?: string
          note?: string | null
          source?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      legal_acceptance_audit: {
        Row: {
          created_at: string
          id: number
          privacy_authorized_at: string
          privacy_version: string
          terms_accepted_at: string
          terms_version: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          privacy_authorized_at: string
          privacy_version: string
          terms_accepted_at: string
          terms_version: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          privacy_authorized_at?: string
          privacy_version?: string
          terms_accepted_at?: string
          terms_version?: string
          user_id?: string
        }
        Relationships: []
      }
      pqr_events: {
        Row: {
          actor_email: string
          created_at: string
          email_status: string | null
          event_type: string
          id: string
          new_status: string | null
          note: string | null
          old_status: string | null
          response: string | null
          submission_id: string
        }
        Insert: {
          actor_email: string
          created_at?: string
          email_status?: string | null
          event_type: string
          id?: string
          new_status?: string | null
          note?: string | null
          old_status?: string | null
          response?: string | null
          submission_id: string
        }
        Update: {
          actor_email?: string
          created_at?: string
          email_status?: string | null
          event_type?: string
          id?: string
          new_status?: string | null
          note?: string | null
          old_status?: string | null
          response?: string | null
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pqr_events_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "pqr_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      pqr_rate_limits: {
        Row: {
          request_count: number
          source_hash: string
          updated_at: string
          window_started_at: string
        }
        Insert: {
          request_count?: number
          source_hash: string
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          request_count?: number
          source_hash?: string
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      pqr_submissions: {
        Row: {
          attachment_path: string | null
          consented_at: string
          created_at: string
          email: string
          full_name: string
          id: string
          message: string
          notification_error: string | null
          notification_sent_at: string | null
          notification_status: string
          privacy_version: string
          reference_code: string
          request_type: string
          responded_at: string | null
          source_hash: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          attachment_path?: string | null
          consented_at?: string
          created_at?: string
          email: string
          full_name: string
          id?: string
          message: string
          notification_error?: string | null
          notification_sent_at?: string | null
          notification_status?: string
          privacy_version?: string
          reference_code: string
          request_type: string
          responded_at?: string | null
          source_hash?: string | null
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          attachment_path?: string | null
          consented_at?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          message?: string
          notification_error?: string | null
          notification_sent_at?: string | null
          notification_status?: string
          privacy_version?: string
          reference_code?: string
          request_type?: string
          responded_at?: string | null
          source_hash?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      shortcut_authorizations: {
        Row: {
          created_at: string
          device_name: string
          expires_at: string | null
          id: string
          last_used_at: string | null
          revoked_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_name?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_name?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      shortcut_link_codes: {
        Row: {
          code_hash: string
          created_at: string
          device_name: string
          expires_at: string
          id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          device_name?: string
          expires_at: string
          id?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          device_name?: string
          expires_at?: string
          id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_expense_categories: {
        Row: {
          created_at: string
          description: string
          icon: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string
          icon?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          icon?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      issue_shortcut_authorization: {
        Args: {
          p_device_name: string
          p_expires_at: string
          p_token_hash: string
          p_user_id: string
        }
        Returns: boolean
      }
      pqr_consume_rate_limit: {
        Args: {
          p_limit?: number
          p_source_hash: string
          p_window_seconds?: number
        }
        Returns: boolean
      }
      save_monthly_budget: {
        Args: {
          p_categories: Json
          p_expense_limit: number
          p_income_amount: number
          p_mode: string
          p_period_month: string
          p_savings_target: number
        }
        Returns: string
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
