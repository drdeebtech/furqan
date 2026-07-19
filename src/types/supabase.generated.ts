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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      achievements: {
        Row: {
          id: string
          metadata_json: Json
          student_id: string
          type: string
          unlocked_at: string
        }
        Insert: {
          id?: string
          metadata_json?: Json
          student_id: string
          type: string
          unlocked_at?: string
        }
        Update: {
          id?: string
          metadata_json?: Json
          student_id?: string
          type?: string
          unlocked_at?: string
        }
        Relationships: []
      }
      ai_output_review: {
        Row: {
          auto_send_eligible: boolean
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          output_json: Json | null
          output_text: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          workflow_name: string
        }
        Insert: {
          auto_send_eligible?: boolean
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          output_json?: Json | null
          output_text: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          workflow_name: string
        }
        Update: {
          auto_send_eligible?: boolean
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          output_json?: Json | null
          output_text?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          workflow_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_output_review_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_output_review_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          booking_id: string
          created_at: string
          credit_action: Database["public"]["Enums"]["credit_action"]
          finalized_at: string | null
          id: string
          outcome: Database["public"]["Enums"]["attendance_outcome"]
          session_id: string | null
          student_id: string
          teacher_id: string
          updated_at: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          credit_action?: Database["public"]["Enums"]["credit_action"]
          finalized_at?: string | null
          id?: string
          outcome: Database["public"]["Enums"]["attendance_outcome"]
          session_id?: string | null
          student_id: string
          teacher_id: string
          updated_at?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          credit_action?: Database["public"]["Enums"]["credit_action"]
          finalized_at?: string | null
          id?: string
          outcome?: Database["public"]["Enums"]["attendance_outcome"]
          session_id?: string | null
          student_id?: string
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "v_bookings"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "attendance_records_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "v_sessions"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "attendance_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          changed_by: string | null
          created_at: string
          id: string
          ip_address: string | null
          new_data: Json | null
          old_data: Json | null
          reason: string | null
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          changed_by?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          reason?: string | null
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          reason?: string | null
          record_id?: string | null
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_dead_letter: {
        Row: {
          attempt_count: number
          claimed_at: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          escalated_at: string | null
          event_name: string | null
          first_failed_at: string
          id: string
          idempotency_key: string | null
          last_error: string | null
          last_execution_id: string | null
          last_failed_at: string
          next_retry_at: string | null
          payload_json: Json | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          source_execution_id: string | null
          workflow_id: string | null
          workflow_name: string
        }
        Insert: {
          attempt_count?: number
          claimed_at?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          escalated_at?: string | null
          event_name?: string | null
          first_failed_at?: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          last_execution_id?: string | null
          last_failed_at?: string
          next_retry_at?: string | null
          payload_json?: Json | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_execution_id?: string | null
          workflow_id?: string | null
          workflow_name: string
        }
        Update: {
          attempt_count?: number
          claimed_at?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          escalated_at?: string | null
          event_name?: string | null
          first_failed_at?: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          last_execution_id?: string | null
          last_failed_at?: string
          next_retry_at?: string | null
          payload_json?: Json | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_execution_id?: string | null
          workflow_id?: string | null
          workflow_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_dead_letter_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_dead_letter_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_logs: {
        Row: {
          attempt_count: number
          channel: string | null
          entity_id: string | null
          entity_type: string | null
          error_message: string | null
          event_name: string | null
          finished_at: string | null
          id: string
          idempotency_key: string | null
          payload_json: Json | null
          result_json: Json | null
          retry_at: string | null
          started_at: string
          status: string
          trace_id: string
          workflow_name: string
        }
        Insert: {
          attempt_count?: number
          channel?: string | null
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          event_name?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          payload_json?: Json | null
          result_json?: Json | null
          retry_at?: string | null
          started_at?: string
          status?: string
          trace_id?: string
          workflow_name: string
        }
        Update: {
          attempt_count?: number
          channel?: string | null
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          event_name?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          payload_json?: Json | null
          result_json?: Json | null
          retry_at?: string | null
          started_at?: string
          status?: string
          trace_id?: string
          workflow_name?: string
        }
        Relationships: []
      }
      availability_exceptions: {
        Row: {
          created_at: string
          date: string
          end_time: string | null
          id: string
          is_blocked: boolean
          reason: string | null
          start_time: string | null
          teacher_id: string
        }
        Insert: {
          created_at?: string
          date: string
          end_time?: string | null
          id?: string
          is_blocked?: boolean
          reason?: string | null
          start_time?: string | null
          teacher_id: string
        }
        Update: {
          created_at?: string
          date?: string
          end_time?: string | null
          id?: string
          is_blocked?: boolean
          reason?: string | null
          start_time?: string | null
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_exceptions_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_exceptions_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          created_at: string
          error_detail: string | null
          event_type: string
          id: string
          payload: Json
          provider: string
          status: Database["public"]["Enums"]["billing_event_status"]
          stripe_customer_id: string | null
          stripe_event_created: string
          stripe_event_id: string
          subscription_id: string | null
        }
        Insert: {
          created_at?: string
          error_detail?: string | null
          event_type: string
          id?: string
          payload: Json
          provider?: string
          status?: Database["public"]["Enums"]["billing_event_status"]
          stripe_customer_id?: string | null
          stripe_event_created: string
          stripe_event_id: string
          subscription_id?: string | null
        }
        Update: {
          created_at?: string
          error_detail?: string | null
          event_type?: string
          id?: string
          payload?: Json
          provider?: string
          status?: Database["public"]["Enums"]["billing_event_status"]
          stripe_customer_id?: string | null
          stripe_event_created?: string
          stripe_event_id?: string
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_posts: {
        Row: {
          body_ar: string
          body_en: string
          category_ar: string
          category_en: string
          color: string
          cover_alt_ar: string | null
          cover_alt_en: string | null
          cover_image_path: string | null
          created_at: string | null
          excerpt_ar: string
          excerpt_en: string
          id: string
          is_published: boolean | null
          published_at: string | null
          read_time_ar: string
          read_time_en: string
          slug: string
          title_ar: string
          title_en: string
          updated_at: string | null
        }
        Insert: {
          body_ar: string
          body_en: string
          category_ar: string
          category_en: string
          color?: string
          cover_alt_ar?: string | null
          cover_alt_en?: string | null
          cover_image_path?: string | null
          created_at?: string | null
          excerpt_ar: string
          excerpt_en: string
          id?: string
          is_published?: boolean | null
          published_at?: string | null
          read_time_ar?: string
          read_time_en?: string
          slug: string
          title_ar: string
          title_en: string
          updated_at?: string | null
        }
        Update: {
          body_ar?: string
          body_en?: string
          category_ar?: string
          category_en?: string
          color?: string
          cover_alt_ar?: string | null
          cover_alt_en?: string | null
          cover_image_path?: string | null
          created_at?: string | null
          excerpt_ar?: string
          excerpt_en?: string
          id?: string
          is_published?: boolean | null
          published_at?: string | null
          read_time_ar?: string
          read_time_en?: string
          slug?: string
          title_ar?: string
          title_en?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      bookings: {
        Row: {
          amount_local: number | null
          amount_usd: number
          booking_product_type: string | null
          cancel_reason: string | null
          cancel_reason_code:
            | Database["public"]["Enums"]["booking_cancel_reason_code"]
            | null
          cancel_reason_detail: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          class_offering_id: string | null
          created_at: string
          created_by: string | null
          decline_reason: string | null
          deleted_at: string | null
          duration_min: number
          exchange_rate: number | null
          id: string
          local_currency: string | null
          notes: string | null
          purpose: Database["public"]["Enums"]["specialized_purpose"] | null
          rate_snapshot: number
          refund_policy_id: string | null
          rescheduled_from: string | null
          scheduled_at: string | null
          session_id: string | null
          session_type: Database["public"]["Enums"]["session_type"]
          specialty: string | null
          status: Database["public"]["Enums"]["booking_status"]
          student_id: string
          student_package_id: string | null
          subscription_id: string | null
          target_scope: Json | null
          tax_amount: number
          tax_rate: number
          teacher_confirmed: boolean
          teacher_confirmed_at: string | null
          teacher_id: string
          use_prepaid_hours: boolean
        }
        Insert: {
          amount_local?: number | null
          amount_usd: number
          booking_product_type?: string | null
          cancel_reason?: string | null
          cancel_reason_code?:
            | Database["public"]["Enums"]["booking_cancel_reason_code"]
            | null
          cancel_reason_detail?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          class_offering_id?: string | null
          created_at?: string
          created_by?: string | null
          decline_reason?: string | null
          deleted_at?: string | null
          duration_min: number
          exchange_rate?: number | null
          id?: string
          local_currency?: string | null
          notes?: string | null
          purpose?: Database["public"]["Enums"]["specialized_purpose"] | null
          rate_snapshot: number
          refund_policy_id?: string | null
          rescheduled_from?: string | null
          scheduled_at?: string | null
          session_id?: string | null
          session_type?: Database["public"]["Enums"]["session_type"]
          specialty?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          student_id: string
          student_package_id?: string | null
          subscription_id?: string | null
          target_scope?: Json | null
          tax_amount?: number
          tax_rate?: number
          teacher_confirmed?: boolean
          teacher_confirmed_at?: string | null
          teacher_id: string
          use_prepaid_hours?: boolean
        }
        Update: {
          amount_local?: number | null
          amount_usd?: number
          booking_product_type?: string | null
          cancel_reason?: string | null
          cancel_reason_code?:
            | Database["public"]["Enums"]["booking_cancel_reason_code"]
            | null
          cancel_reason_detail?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          class_offering_id?: string | null
          created_at?: string
          created_by?: string | null
          decline_reason?: string | null
          deleted_at?: string | null
          duration_min?: number
          exchange_rate?: number | null
          id?: string
          local_currency?: string | null
          notes?: string | null
          purpose?: Database["public"]["Enums"]["specialized_purpose"] | null
          rate_snapshot?: number
          refund_policy_id?: string | null
          rescheduled_from?: string | null
          scheduled_at?: string | null
          session_id?: string | null
          session_type?: Database["public"]["Enums"]["session_type"]
          specialty?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          student_id?: string
          student_package_id?: string | null
          subscription_id?: string | null
          target_scope?: Json | null
          tax_amount?: number
          tax_rate?: number
          teacher_confirmed?: boolean
          teacher_confirmed_at?: string | null
          teacher_id?: string
          use_prepaid_hours?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "bookings_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_class_offering_id_fkey"
            columns: ["class_offering_id"]
            isOneToOne: false
            referencedRelation: "class_offerings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_refund_policy_id_fkey"
            columns: ["refund_policy_id"]
            isOneToOne: false
            referencedRelation: "refund_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_rescheduled_from_fkey"
            columns: ["rescheduled_from"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_rescheduled_from_fkey"
            columns: ["rescheduled_from"]
            isOneToOne: false
            referencedRelation: "v_bookings"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "bookings_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "v_sessions"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "bookings_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_student_package_id_fkey"
            columns: ["student_package_id"]
            isOneToOne: false
            referencedRelation: "student_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_student_package_id_fkey"
            columns: ["student_package_id"]
            isOneToOne: false
            referencedRelation: "v_package_effective_status"
            referencedColumns: ["student_package_id"]
          },
          {
            foreignKeyName: "bookings_student_package_id_fkey"
            columns: ["student_package_id"]
            isOneToOne: false
            referencedRelation: "v_student_packages"
            referencedColumns: ["student_package_id"]
          },
          {
            foreignKeyName: "bookings_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      certificates: {
        Row: {
          certificate_type: Database["public"]["Enums"]["certificate_type"]
          cited_range_end: string
          cited_range_start: string
          created_at: string
          id: string
          issued_at: string
          milestone_key: string
          pdf_generated_at: string | null
          pdf_url: string | null
          public_slug: string
          student_id: string
        }
        Insert: {
          certificate_type: Database["public"]["Enums"]["certificate_type"]
          cited_range_end: string
          cited_range_start: string
          created_at?: string
          id?: string
          issued_at?: string
          milestone_key: string
          pdf_generated_at?: string | null
          pdf_url?: string | null
          public_slug?: string
          student_id: string
        }
        Update: {
          certificate_type?: Database["public"]["Enums"]["certificate_type"]
          cited_range_end?: string
          cited_range_start?: string
          created_at?: string
          id?: string
          issued_at?: string
          milestone_key?: string
          pdf_generated_at?: string | null
          pdf_url?: string | null
          public_slug?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "certificates_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      class_offerings: {
        Row: {
          capacity: number
          created_at: string
          current_enrollment: number
          description: string | null
          duration_min: number
          entry_conditions_json: Json | null
          id: string
          price_usd: number
          program_level: string | null
          schedule_json: Json | null
          scheduled_at: string
          session_duration_min: number | null
          session_id: string | null
          session_type: Database["public"]["Enums"]["session_type"]
          start_date: string | null
          status: string
          teacher_id: string
          title: string
          updated_at: string
        }
        Insert: {
          capacity: number
          created_at?: string
          current_enrollment?: number
          description?: string | null
          duration_min: number
          entry_conditions_json?: Json | null
          id?: string
          price_usd: number
          program_level?: string | null
          schedule_json?: Json | null
          scheduled_at: string
          session_duration_min?: number | null
          session_id?: string | null
          session_type: Database["public"]["Enums"]["session_type"]
          start_date?: string | null
          status?: string
          teacher_id: string
          title: string
          updated_at?: string
        }
        Update: {
          capacity?: number
          created_at?: string
          current_enrollment?: number
          description?: string | null
          duration_min?: number
          entry_conditions_json?: Json | null
          id?: string
          price_usd?: number
          program_level?: string | null
          schedule_json?: Json | null
          scheduled_at?: string
          session_duration_min?: number | null
          session_id?: string | null
          session_type?: Database["public"]["Enums"]["session_type"]
          start_date?: string | null
          status?: string
          teacher_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_offerings_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_offerings_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "v_sessions"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "class_offerings_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_offerings_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_preferences: {
        Row: {
          created_at: string
          email_enabled: boolean
          id: string
          important_only_mode: boolean
          in_app_enabled: boolean
          preferred_language: string
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          updated_at: string
          user_id: string
          whatsapp_enabled: boolean
        }
        Insert: {
          created_at?: string
          email_enabled?: boolean
          id?: string
          important_only_mode?: boolean
          in_app_enabled?: boolean
          preferred_language?: string
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          updated_at?: string
          user_id: string
          whatsapp_enabled?: boolean
        }
        Update: {
          created_at?: string
          email_enabled?: boolean
          id?: string
          important_only_mode?: boolean
          in_app_enabled?: boolean
          preferred_language?: string
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          updated_at?: string
          user_id?: string
          whatsapp_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "communication_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_submissions: {
        Row: {
          admin_notes: string | null
          country: string | null
          created_at: string | null
          email: string
          full_name: string
          id: string
          is_read: boolean | null
          is_replied: boolean | null
          message: string | null
          package_interest: string | null
          student_age: string | null
          whatsapp: string | null
        }
        Insert: {
          admin_notes?: string | null
          country?: string | null
          created_at?: string | null
          email: string
          full_name: string
          id?: string
          is_read?: boolean | null
          is_replied?: boolean | null
          message?: string | null
          package_interest?: string | null
          student_age?: string | null
          whatsapp?: string | null
        }
        Update: {
          admin_notes?: string | null
          country?: string | null
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          is_read?: boolean | null
          is_replied?: boolean | null
          message?: string | null
          package_interest?: string | null
          student_age?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          initiated_by: string
          last_message_at: string | null
          status: string
          student_id: string
          teacher_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          initiated_by: string
          last_message_at?: string | null
          status?: string
          student_id: string
          teacher_id: string
        }
        Update: {
          created_at?: string
          id?: string
          initiated_by?: string
          last_message_at?: string | null
          status?: string
          student_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      course_enrollments: {
        Row: {
          amount_paid_cents: number | null
          completed_at: string | null
          course_id: string
          currency: string | null
          enrolled_at: string
          id: string
          last_accessed_at: string | null
          payment_id: string | null
          platform_fee_cents: number | null
          source: string
          student_id: string
          teacher_earnings_cents: number | null
        }
        Insert: {
          amount_paid_cents?: number | null
          completed_at?: string | null
          course_id: string
          currency?: string | null
          enrolled_at?: string
          id?: string
          last_accessed_at?: string | null
          payment_id?: string | null
          platform_fee_cents?: number | null
          source: string
          student_id: string
          teacher_earnings_cents?: number | null
        }
        Update: {
          amount_paid_cents?: number | null
          completed_at?: string | null
          course_id?: string
          currency?: string | null
          enrolled_at?: string
          id?: string
          last_accessed_at?: string | null
          payment_id?: string | null
          platform_fee_cents?: number | null
          source?: string
          student_id?: string
          teacher_earnings_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "course_enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_enrollments_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      course_lesson_progress: {
        Row: {
          completed_at: string | null
          created_at: string
          enrollment_id: string
          hidden_from_dashboard: boolean
          id: string
          last_position_seconds: number
          lesson_id: string
          updated_at: string
          watch_count: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          enrollment_id: string
          hidden_from_dashboard?: boolean
          id?: string
          last_position_seconds?: number
          lesson_id: string
          updated_at?: string
          watch_count?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          enrollment_id?: string
          hidden_from_dashboard?: boolean
          id?: string
          last_position_seconds?: number
          lesson_id?: string
          updated_at?: string
          watch_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "course_lesson_progress_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "course_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_lesson_progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "course_lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      course_lessons: {
        Row: {
          bunny_video_id: string | null
          course_id: string
          created_at: string
          description_ar: string | null
          description_en: string | null
          duration_seconds: number | null
          id: string
          is_preview: boolean
          order_index: number
          title_ar: string
          title_en: string | null
          updated_at: string
          video_status: string
        }
        Insert: {
          bunny_video_id?: string | null
          course_id: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          duration_seconds?: number | null
          id?: string
          is_preview?: boolean
          order_index: number
          title_ar: string
          title_en?: string | null
          updated_at?: string
          video_status?: string
        }
        Update: {
          bunny_video_id?: string | null
          course_id?: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          duration_seconds?: number | null
          id?: string
          is_preview?: boolean
          order_index?: number
          title_ar?: string
          title_en?: string | null
          updated_at?: string
          video_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_lessons_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_payouts: {
        Row: {
          created_at: string
          currency: string
          id: string
          notes: string | null
          paid_out_at: string | null
          payout_reference: string | null
          period_end: string
          period_start: string
          platform_fee_cents: number
          status: string
          teacher_earnings_cents: number
          teacher_id: string
          total_sales_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency: string
          id?: string
          notes?: string | null
          paid_out_at?: string | null
          payout_reference?: string | null
          period_end: string
          period_start: string
          platform_fee_cents?: number
          status?: string
          teacher_earnings_cents?: number
          teacher_id: string
          total_sales_cents?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          notes?: string | null
          paid_out_at?: string | null
          payout_reference?: string | null
          period_end?: string
          period_start?: string
          platform_fee_cents?: number
          status?: string
          teacher_earnings_cents?: number
          teacher_id?: string
          total_sales_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_payouts_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_payouts_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      course_reviews: {
        Row: {
          comment: string | null
          course_id: string
          created_at: string
          enrollment_id: string
          id: string
          stars: number
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          comment?: string | null
          course_id: string
          created_at?: string
          enrollment_id: string
          id?: string
          stars: number
          status?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          comment?: string | null
          course_id?: string
          created_at?: string
          enrollment_id?: string
          id?: string
          stars?: number
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_reviews_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_reviews_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "course_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_reviews_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_reviews_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          cover_image_url: string | null
          created_at: string
          currency: string
          deleted_at: string | null
          description_ar: string | null
          description_en: string | null
          duration_seconds_cached: number | null
          enrollment_count_cached: number | null
          id: string
          intro_bunny_video_id: string | null
          language: string | null
          lesson_count_cached: number | null
          level: string | null
          ownership: string
          price_cents: number
          pricing_type: string
          published_at: string | null
          rating_avg_cached: number | null
          rating_count_cached: number | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          slug: string
          specialty: string | null
          status: string
          teacher_id: string | null
          teacher_revenue_share_bps: number
          title_ar: string
          title_en: string | null
          updated_at: string
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          description_ar?: string | null
          description_en?: string | null
          duration_seconds_cached?: number | null
          enrollment_count_cached?: number | null
          id?: string
          intro_bunny_video_id?: string | null
          language?: string | null
          lesson_count_cached?: number | null
          level?: string | null
          ownership?: string
          price_cents?: number
          pricing_type?: string
          published_at?: string | null
          rating_avg_cached?: number | null
          rating_count_cached?: number | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          slug: string
          specialty?: string | null
          status?: string
          teacher_id?: string | null
          teacher_revenue_share_bps?: number
          title_ar: string
          title_en?: string | null
          updated_at?: string
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          description_ar?: string | null
          description_en?: string | null
          duration_seconds_cached?: number | null
          enrollment_count_cached?: number | null
          id?: string
          intro_bunny_video_id?: string | null
          language?: string | null
          lesson_count_cached?: number | null
          level?: string | null
          ownership?: string
          price_cents?: number
          pricing_type?: string
          published_at?: string | null
          rating_avg_cached?: number | null
          rating_count_cached?: number | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          slug?: string
          specialty?: string | null
          status?: string
          teacher_id?: string | null
          teacher_revenue_share_bps?: number
          title_ar?: string
          title_en?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_webhook_events: {
        Row: {
          event_id: string
          event_type: string
          payload_json: Json
          received_at: string
          room_name: string | null
          session_id: string | null
        }
        Insert: {
          event_id: string
          event_type: string
          payload_json: Json
          received_at?: string
          room_name?: string | null
          session_id?: string | null
        }
        Update: {
          event_id?: string
          event_type?: string
          payload_json?: Json
          received_at?: string
          room_name?: string | null
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_webhook_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_webhook_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "v_sessions"
            referencedColumns: ["session_id"]
          },
        ]
      }
      excuse_requests: {
        Row: {
          booking_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          is_eligible: boolean
          reason: string
          status: Database["public"]["Enums"]["excuse_status"]
          student_id: string
          submitted_at: string
          teacher_id: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          is_eligible: boolean
          reason: string
          status?: Database["public"]["Enums"]["excuse_status"]
          student_id: string
          submitted_at?: string
          teacher_id: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          is_eligible?: boolean
          reason?: string
          status?: Database["public"]["Enums"]["excuse_status"]
          student_id?: string
          submitted_at?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "excuse_requests_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excuse_requests_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "excuse_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excuse_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excuse_requests_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excuse_requests_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excuse_requests_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excuse_requests_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_likes: {
        Row: {
          created_at: string
          target_id: string
          target_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          target_id: string
          target_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          target_id?: string
          target_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_replies: {
        Row: {
          author_id: string
          body_ar: string
          body_en: string | null
          created_at: string
          id: string
          is_hidden: boolean
          thread_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body_ar: string
          body_en?: string | null
          created_at?: string
          id?: string
          is_hidden?: boolean
          thread_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body_ar?: string
          body_en?: string | null
          created_at?: string
          id?: string
          is_hidden?: boolean
          thread_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_replies_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_replies_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_replies_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "forum_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_reports: {
        Row: {
          created_at: string
          id: string
          reason: string | null
          reporter_id: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason?: string | null
          reporter_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string | null
          reporter_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_threads: {
        Row: {
          author_id: string
          body_ar: string
          body_en: string | null
          category: string
          created_at: string
          id: string
          is_hidden: boolean
          is_locked: boolean
          is_pinned: boolean
          last_reply_at: string | null
          reply_count: number
          title_ar: string
          title_en: string | null
          updated_at: string
        }
        Insert: {
          author_id: string
          body_ar: string
          body_en?: string | null
          category?: string
          created_at?: string
          id?: string
          is_hidden?: boolean
          is_locked?: boolean
          is_pinned?: boolean
          last_reply_at?: string | null
          reply_count?: number
          title_ar: string
          title_en?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string
          body_ar?: string
          body_en?: string | null
          category?: string
          created_at?: string
          id?: string
          is_hidden?: boolean
          is_locked?: boolean
          is_pinned?: boolean
          last_reply_at?: string | null
          reply_count?: number
          title_ar?: string
          title_en?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_threads_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_threads_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_children: {
        Row: {
          child_id: string
          created_at: string
          guardian_id: string
        }
        Insert: {
          child_id: string
          created_at?: string
          guardian_id: string
        }
        Update: {
          child_id?: string
          created_at?: string
          guardian_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardian_children_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_children_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_children_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_children_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      halaqa_waiting_list: {
        Row: {
          created_at: string
          id: string
          position: number
          promoted_at: string | null
          session_id: string
          student_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          position: number
          promoted_at?: string | null
          session_id: string
          student_id: string
        }
        Update: {
          created_at?: string
          id?: string
          position?: number
          promoted_at?: string | null
          session_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "halaqa_waiting_list_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "halaqa_waiting_list_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "v_sessions"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "halaqa_waiting_list_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "halaqa_waiting_list_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      help_articles: {
        Row: {
          body_ar: string
          body_en: string | null
          category: string
          created_at: string
          created_by: string | null
          id: string
          is_published: boolean
          slug: string
          sort_order: number
          title_ar: string
          title_en: string | null
          updated_at: string
        }
        Insert: {
          body_ar: string
          body_en?: string | null
          category: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_published?: boolean
          slug: string
          sort_order?: number
          title_ar: string
          title_en?: string | null
          updated_at?: string
        }
        Update: {
          body_ar?: string
          body_en?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_published?: boolean
          slug?: string
          sort_order?: number
          title_ar?: string
          title_en?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "help_articles_category_fkey"
            columns: ["category"]
            isOneToOne: false
            referencedRelation: "help_categories"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "help_articles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "help_articles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      help_categories: {
        Row: {
          created_at: string
          label_ar: string
          label_en: string | null
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          label_ar: string
          label_en?: string | null
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          label_ar?: string
          label_en?: string | null
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      homework_assignments: {
        Row: {
          assigned_at: string
          audio_duration_seconds: number | null
          audio_url: string | null
          ayah_end: number | null
          ayah_start: number | null
          booking_id: string
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          homework_type: Database["public"]["Enums"]["homework_type"]
          id: string
          pages_count: number | null
          parent_assignment_id: string | null
          ready_at: string | null
          review_horizon: string
          session_id: string | null
          status: Database["public"]["Enums"]["homework_status"]
          student_id: string
          surah_number: number | null
          teacher_id: string
          teacher_notes: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          audio_duration_seconds?: number | null
          audio_url?: string | null
          ayah_end?: number | null
          ayah_start?: number | null
          booking_id: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          homework_type: Database["public"]["Enums"]["homework_type"]
          id?: string
          pages_count?: number | null
          parent_assignment_id?: string | null
          ready_at?: string | null
          review_horizon?: string
          session_id?: string | null
          status?: Database["public"]["Enums"]["homework_status"]
          student_id: string
          surah_number?: number | null
          teacher_id: string
          teacher_notes?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          audio_duration_seconds?: number | null
          audio_url?: string | null
          ayah_end?: number | null
          ayah_start?: number | null
          booking_id?: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          homework_type?: Database["public"]["Enums"]["homework_type"]
          id?: string
          pages_count?: number | null
          parent_assignment_id?: string | null
          ready_at?: string | null
          review_horizon?: string
          session_id?: string | null
          status?: Database["public"]["Enums"]["homework_status"]
          student_id?: string
          surah_number?: number | null
          teacher_id?: string
          teacher_notes?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_assignments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "homework_assignments_parent_assignment_id_fkey"
            columns: ["parent_assignment_id"]
            isOneToOne: false
            referencedRelation: "homework_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_parent_assignment_id_fkey"
            columns: ["parent_assignment_id"]
            isOneToOne: false
            referencedRelation: "v_homework"
            referencedColumns: ["homework_id"]
          },
          {
            foreignKeyName: "homework_assignments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "v_sessions"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "homework_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      honor_board_entries: {
        Row: {
          achievement_metric: number | null
          avatar_url: string | null
          computed_at: string
          created_at: string
          display_name: string | null
          id: string
          is_opted_out: boolean
          rank_period: string
          student_id: string
        }
        Insert: {
          achievement_metric?: number | null
          avatar_url?: string | null
          computed_at?: string
          created_at?: string
          display_name?: string | null
          id?: string
          is_opted_out?: boolean
          rank_period: string
          student_id: string
        }
        Update: {
          achievement_metric?: number | null
          avatar_url?: string | null
          computed_at?: string
          created_at?: string
          display_name?: string | null
          id?: string
          is_opted_out?: boolean
          rank_period?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "honor_board_entries_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "honor_board_entries_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ijazah_pathways: {
        Row: {
          created_at: string
          description_ar: string | null
          description_en: string | null
          id: string
          is_active: boolean
          name_ar: string
          name_en: string
          recitation_standard: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          id?: string
          is_active?: boolean
          name_ar: string
          name_en: string
          recitation_standard: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string
          recitation_standard?: string
          updated_at?: string
        }
        Relationships: []
      }
      ijazah_requirements: {
        Row: {
          created_at: string
          description_ar: string
          description_en: string
          id: string
          pathway_id: string
          requirement_payload: Json
          requirement_type: string
          sequence: number
        }
        Insert: {
          created_at?: string
          description_ar: string
          description_en: string
          id?: string
          pathway_id: string
          requirement_payload?: Json
          requirement_type: string
          sequence: number
        }
        Update: {
          created_at?: string
          description_ar?: string
          description_en?: string
          id?: string
          pathway_id?: string
          requirement_payload?: Json
          requirement_type?: string
          sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "ijazah_requirements_pathway_id_fkey"
            columns: ["pathway_id"]
            isOneToOne: false
            referencedRelation: "ijazah_pathways"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_usd: number
          created_at: string
          currency: string
          exchange_rate_snapshot: number | null
          id: string
          invoice_number: string
          issued_at: string
          payment_id: string
          pdf_url: string | null
          student_id: string
          student_name_snapshot: string
          tax_amount: number
        }
        Insert: {
          amount_usd: number
          created_at?: string
          currency: string
          exchange_rate_snapshot?: number | null
          id?: string
          invoice_number: string
          issued_at?: string
          payment_id: string
          pdf_url?: string | null
          student_id: string
          student_name_snapshot: string
          tax_amount?: number
        }
        Update: {
          amount_usd?: number
          created_at?: string
          currency?: string
          exchange_rate_snapshot?: number | null
          id?: string
          invoice_number?: string
          issued_at?: string
          payment_id?: string
          pdf_url?: string | null
          student_id?: string
          student_name_snapshot?: string
          tax_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_document_versions: {
        Row: {
          body_ar: string | null
          body_en: string | null
          created_at: string
          effective_at: string
          id: string
          kind: string
          saved_by: string | null
          superseded_at: string | null
          version: number
        }
        Insert: {
          body_ar?: string | null
          body_en?: string | null
          created_at?: string
          effective_at: string
          id?: string
          kind: string
          saved_by?: string | null
          superseded_at?: string | null
          version: number
        }
        Update: {
          body_ar?: string | null
          body_en?: string | null
          created_at?: string
          effective_at?: string
          id?: string
          kind?: string
          saved_by?: string | null
          superseded_at?: string | null
          version?: number
        }
        Relationships: []
      }
      legal_documents: {
        Row: {
          body_ar: string | null
          body_en: string | null
          kind: string
          updated_at: string
          version: number
        }
        Insert: {
          body_ar?: string | null
          body_en?: string | null
          kind: string
          updated_at?: string
          version?: number
        }
        Update: {
          body_ar?: string | null
          body_en?: string | null
          kind?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      message_delivery_log: {
        Row: {
          attempted_at: string
          created_at: string
          delivered_at: string | null
          failed_at: string | null
          failure_reason: string | null
          id: string
          provider_message_id: string | null
          recipient_channel: string
          recipient_user_id: string
          related_entity_id: string | null
          related_entity_type: string | null
          status: string
          template_name: string | null
        }
        Insert: {
          attempted_at?: string
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          provider_message_id?: string | null
          recipient_channel: string
          recipient_user_id: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          status?: string
          template_name?: string | null
        }
        Update: {
          attempted_at?: string
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          provider_message_id?: string | null
          recipient_channel?: string
          recipient_user_id?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          status?: string
          template_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_delivery_log_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_delivery_log_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          file_url: string | null
          flag_reason: string | null
          flagged_at: string | null
          flagged_by: string | null
          hidden_at: string | null
          hidden_by: string | null
          id: string
          is_read: boolean
          msg_type: Database["public"]["Enums"]["msg_type"]
          sender_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          file_url?: string | null
          flag_reason?: string | null
          flagged_at?: string | null
          flagged_by?: string | null
          hidden_at?: string | null
          hidden_by?: string | null
          id?: string
          is_read?: boolean
          msg_type?: Database["public"]["Enums"]["msg_type"]
          sender_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          file_url?: string | null
          flag_reason?: string | null
          flagged_at?: string | null
          flagged_by?: string | null
          hidden_at?: string | null
          hidden_by?: string | null
          id?: string
          is_read?: boolean
          msg_type?: Database["public"]["Enums"]["msg_type"]
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_flagged_by_fkey"
            columns: ["flagged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_flagged_by_fkey"
            columns: ["flagged_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_hidden_by_fkey"
            columns: ["hidden_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_hidden_by_fkey"
            columns: ["hidden_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      module_lessons: {
        Row: {
          lesson_id: string
          module_id: string
          sort_order: number
        }
        Insert: {
          lesson_id: string
          module_id: string
          sort_order?: number
        }
        Update: {
          lesson_id?: string
          module_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "module_lessons_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: true
            referencedRelation: "course_lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_lessons_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      modules: {
        Row: {
          course_id: string
          created_at: string
          description_ar: string | null
          description_en: string | null
          id: string
          is_linear: boolean
          sort_order: number
          title_ar: string
          title_en: string | null
          updated_at: string
        }
        Insert: {
          course_id: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          id?: string
          is_linear?: boolean
          sort_order?: number
          title_ar: string
          title_en?: string | null
          updated_at?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          id?: string
          is_linear?: boolean
          sort_order?: number
          title_ar?: string
          title_en?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_reports: {
        Row: {
          created_at: string
          generated_at: string
          id: string
          level_assessment_summary: string | null
          period_month: number
          period_year: number
          student_id: string
          subscription_id: string | null
          version: number
        }
        Insert: {
          created_at?: string
          generated_at?: string
          id?: string
          level_assessment_summary?: string | null
          period_month: number
          period_year: number
          student_id: string
          subscription_id?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          generated_at?: string
          id?: string
          level_assessment_summary?: string | null
          period_month?: number
          period_year?: number
          student_id?: string
          subscription_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "monthly_reports_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_reports_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_reports_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_broadcasts: {
        Row: {
          body: string | null
          created_at: string
          cursor_after: string | null
          id: string
          initiated_by: string | null
          processed_at: string | null
          recipients_failed: number
          recipients_sent: number
          status: string
          target: string
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          cursor_after?: string | null
          id?: string
          initiated_by?: string | null
          processed_at?: string | null
          recipients_failed?: number
          recipients_sent?: number
          status?: string
          target: string
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          cursor_after?: string | null
          id?: string
          initiated_by?: string | null
          processed_at?: string | null
          recipients_failed?: number
          recipients_sent?: number
          status?: string
          target?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_broadcasts_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_broadcasts_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          channel: string[]
          created_at: string
          data: Json | null
          expires_at: string | null
          id: string
          is_read: boolean
          title: string
          type: Database["public"]["Enums"]["notif_type"]
          user_id: string
        }
        Insert: {
          body?: string | null
          channel?: string[]
          created_at?: string
          data?: Json | null
          expires_at?: string | null
          id?: string
          is_read?: boolean
          title: string
          type: Database["public"]["Enums"]["notif_type"]
          user_id: string
        }
        Update: {
          body?: string | null
          channel?: string[]
          created_at?: string
          data?: Json | null
          expires_at?: string | null
          id?: string
          is_read?: boolean
          title?: string
          type?: Database["public"]["Enums"]["notif_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          created_at: string
          description: string | null
          description_ar: string | null
          display_order: number | null
          duration_min: number
          features: string[] | null
          features_ar: string[] | null
          halaqa_pricing_tiers: Json | null
          id: string
          is_active: boolean | null
          is_featured: boolean | null
          is_hifz_product: boolean
          name: string
          name_ar: string | null
          package_type: string
          price_aud: number | null
          price_gbp: number | null
          price_sar: number | null
          price_usd: number
          product_category: string | null
          session_count: number
          session_mode_allowances: Json
          subscription_plan_id: string | null
          supports_session_modes: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          description_ar?: string | null
          display_order?: number | null
          duration_min?: number
          features?: string[] | null
          features_ar?: string[] | null
          halaqa_pricing_tiers?: Json | null
          id?: string
          is_active?: boolean | null
          is_featured?: boolean | null
          is_hifz_product?: boolean
          name: string
          name_ar?: string | null
          package_type: string
          price_aud?: number | null
          price_gbp?: number | null
          price_sar?: number | null
          price_usd: number
          product_category?: string | null
          session_count: number
          session_mode_allowances?: Json
          subscription_plan_id?: string | null
          supports_session_modes?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          description_ar?: string | null
          display_order?: number | null
          duration_min?: number
          features?: string[] | null
          features_ar?: string[] | null
          halaqa_pricing_tiers?: Json | null
          id?: string
          is_active?: boolean | null
          is_featured?: boolean | null
          is_hifz_product?: boolean
          name?: string
          name_ar?: string | null
          package_type?: string
          price_aud?: number | null
          price_gbp?: number | null
          price_sar?: number | null
          price_usd?: number
          product_category?: string | null
          session_count?: number
          session_mode_allowances?: Json
          subscription_plan_id?: string | null
          supports_session_modes?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packages_subscription_plan_id_fkey"
            columns: ["subscription_plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_access_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          revoked_at: string | null
          student_id: string
          teacher_id: string
          token_hash: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          revoked_at?: string | null
          student_id: string
          teacher_id: string
          token_hash: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          student_id?: string
          teacher_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "parent_access_tokens_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_access_tokens_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_access_tokens_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_access_tokens_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_reports: {
        Row: {
          content: string
          created_at: string
          error: string | null
          id: string
          parent_email: string | null
          parent_phone: string | null
          read_at: string | null
          report_type: Database["public"]["Enums"]["report_type"]
          sent_at: string | null
          sent_via: string[] | null
          student_id: string
          teacher_id: string
          title: string | null
        }
        Insert: {
          content: string
          created_at?: string
          error?: string | null
          id?: string
          parent_email?: string | null
          parent_phone?: string | null
          read_at?: string | null
          report_type: Database["public"]["Enums"]["report_type"]
          sent_at?: string | null
          sent_via?: string[] | null
          student_id: string
          teacher_id: string
          title?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          error?: string | null
          id?: string
          parent_email?: string | null
          parent_phone?: string | null
          read_at?: string | null
          report_type?: Database["public"]["Enums"]["report_type"]
          sent_at?: string | null
          sent_via?: string[] | null
          student_id?: string
          teacher_id?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parent_reports_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_reports_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_reports_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_reports_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount_usd: number
          created_at: string
          description: string | null
          id: string
          payment_id: string
          stripe_id: string | null
          type: string
        }
        Insert: {
          amount_usd: number
          created_at?: string
          description?: string | null
          id?: string
          payment_id: string
          stripe_id?: string | null
          type: string
        }
        Update: {
          amount_usd?: number
          created_at?: string
          description?: string | null
          id?: string
          payment_id?: string
          stripe_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_holds: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          reason: string
          released_at: string | null
          released_by: string | null
          source: Database["public"]["Enums"]["payout_hold_source"]
          teacher_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          reason: string
          released_at?: string | null
          released_by?: string | null
          source: Database["public"]["Enums"]["payout_hold_source"]
          teacher_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string
          released_at?: string | null
          released_by?: string | null
          source?: Database["public"]["Enums"]["payout_hold_source"]
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_holds_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_holds_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_holds_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_holds_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_holds_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_holds_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_before_tax: number
          amount_local: number | null
          amount_usd: number
          booking_id: string | null
          captured_at: string | null
          created_at: string
          exchange_rate_snapshot: number | null
          id: string
          local_currency: string | null
          package_id: string | null
          paid_at: string | null
          payer_email: string | null
          paypal_capture_id: string | null
          paypal_order_id: string | null
          provider: string
          revenue_recognized: number
          status: Database["public"]["Enums"]["payment_status"]
          stripe_payment_intent: string | null
          student_id: string
          tax_amount: number
          tax_rate: number
        }
        Insert: {
          amount_before_tax?: number
          amount_local?: number | null
          amount_usd: number
          booking_id?: string | null
          captured_at?: string | null
          created_at?: string
          exchange_rate_snapshot?: number | null
          id?: string
          local_currency?: string | null
          package_id?: string | null
          paid_at?: string | null
          payer_email?: string | null
          paypal_capture_id?: string | null
          paypal_order_id?: string | null
          provider?: string
          revenue_recognized?: number
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_payment_intent?: string | null
          student_id: string
          tax_amount?: number
          tax_rate?: number
        }
        Update: {
          amount_before_tax?: number
          amount_local?: number | null
          amount_usd?: number
          booking_id?: string | null
          captured_at?: string | null
          created_at?: string
          exchange_rate_snapshot?: number | null
          id?: string
          local_currency?: string | null
          package_id?: string | null
          paid_at?: string | null
          payer_email?: string | null
          paypal_capture_id?: string | null
          paypal_order_id?: string | null
          provider?: string
          revenue_recognized?: number
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_payment_intent?: string | null
          student_id?: string
          tax_amount?: number
          tax_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_payments_booking"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_payments_booking"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "v_bookings"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "payments_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_tier_changes: {
        Row: {
          applied_at: string | null
          applies_at_period_end: boolean
          change_reason: string
          created_at: string
          from_package_id: string
          id: string
          requested_at: string
          status: string
          student_id: string
          subscription_id: string
          to_package_id: string
        }
        Insert: {
          applied_at?: string | null
          applies_at_period_end?: boolean
          change_reason: string
          created_at?: string
          from_package_id: string
          id?: string
          requested_at?: string
          status?: string
          student_id: string
          subscription_id: string
          to_package_id: string
        }
        Update: {
          applied_at?: string | null
          applies_at_period_end?: boolean
          change_reason?: string
          created_at?: string
          from_package_id?: string
          id?: string
          requested_at?: string
          status?: string
          student_id?: string
          subscription_id?: string
          to_package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_tier_changes_from_package_id_fkey"
            columns: ["from_package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_tier_changes_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_tier_changes_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_tier_changes_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_tier_changes_to_package_id_fkey"
            columns: ["to_package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_upgrade_grants: {
        Row: {
          applied_at: string | null
          created_at: string
          delta_sessions: number
          id: string
          plan_id: string
          status: string
          stripe_invoice_id: string
          student_id: string
          subscription_id: string
        }
        Insert: {
          applied_at?: string | null
          created_at?: string
          delta_sessions: number
          id?: string
          plan_id: string
          status?: string
          stripe_invoice_id: string
          student_id: string
          subscription_id: string
        }
        Update: {
          applied_at?: string | null
          created_at?: string
          delta_sessions?: number
          id?: string
          plan_id?: string
          status?: string
          stripe_invoice_id?: string
          student_id?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_upgrade_grants_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_upgrade_grants_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_upgrade_grants_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_upgrade_grants_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          description: string | null
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: string
        }
        Insert: {
          description?: string | null
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value: string
        }
        Update: {
          description?: string | null
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prepaid_hours_events: {
        Row: {
          created_at: string
          event_type: string
          hours_delta: number
          id: string
          package_id: string
          stripe_ref: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          hours_delta: number
          id?: string
          package_id: string
          stripe_ref?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          hours_delta?: number
          id?: string
          package_id?: string
          stripe_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prepaid_hours_events_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "student_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prepaid_hours_events_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "v_package_effective_status"
            referencedColumns: ["student_package_id"]
          },
          {
            foreignKeyName: "prepaid_hours_events_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "v_student_packages"
            referencedColumns: ["student_package_id"]
          },
        ]
      }
      prepaid_refund_requests: {
        Row: {
          amount_usd: number
          created_at: string
          hours: number
          id: string
          package_id: string
          resolved_at: string | null
          status: string
          stripe_payment_intent_id: string
          stripe_refund_id: string | null
        }
        Insert: {
          amount_usd: number
          created_at?: string
          hours: number
          id: string
          package_id: string
          resolved_at?: string | null
          status?: string
          stripe_payment_intent_id: string
          stripe_refund_id?: string | null
        }
        Update: {
          amount_usd?: number
          created_at?: string
          hours?: number
          id?: string
          package_id?: string
          resolved_at?: string | null
          status?: string
          stripe_payment_intent_id?: string
          stripe_refund_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prepaid_refund_requests_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "student_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prepaid_refund_requests_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "v_package_effective_status"
            referencedColumns: ["student_package_id"]
          },
          {
            foreignKeyName: "prepaid_refund_requests_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "v_student_packages"
            referencedColumns: ["student_package_id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          country: string | null
          created_at: string
          date_of_birth: string | null
          deleted_at: string | null
          full_name: string | null
          full_name_ar: string | null
          guardian_link_code: string | null
          hourly_rate_usd: number | null
          id: string
          is_active: boolean
          is_test_account: boolean
          lang: string
          onboarding_completed: boolean
          parent_email: string | null
          parent_name: string | null
          parent_phone: string | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          roles: Database["public"]["Enums"]["user_role"][]
          timezone: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          deleted_at?: string | null
          full_name?: string | null
          full_name_ar?: string | null
          guardian_link_code?: string | null
          hourly_rate_usd?: number | null
          id: string
          is_active?: boolean
          is_test_account?: boolean
          lang?: string
          onboarding_completed?: boolean
          parent_email?: string | null
          parent_name?: string | null
          parent_phone?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          roles?: Database["public"]["Enums"]["user_role"][]
          timezone?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          deleted_at?: string | null
          full_name?: string | null
          full_name_ar?: string | null
          guardian_link_code?: string | null
          hourly_rate_usd?: number | null
          id?: string
          is_active?: boolean
          is_test_account?: boolean
          lang?: string
          onboarding_completed?: boolean
          parent_email?: string | null
          parent_name?: string | null
          parent_phone?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          roles?: Database["public"]["Enums"]["user_role"][]
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          keys_auth: string
          keys_p256dh: string
          last_seen_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          keys_auth: string
          keys_p256dh: string
          last_seen_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          keys_auth?: string
          keys_p256dh?: string
          last_seen_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      quiz_attempts: {
        Row: {
          answers: Json | null
          created_at: string
          duration_seconds: number | null
          id: string
          passed: boolean | null
          quiz_id: string
          score_pct: number | null
          started_at: string
          student_id: string
          submitted_at: string | null
        }
        Insert: {
          answers?: Json | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          passed?: boolean | null
          quiz_id: string
          score_pct?: number | null
          started_at?: string
          student_id: string
          submitted_at?: string | null
        }
        Update: {
          answers?: Json | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          passed?: boolean | null
          quiz_id?: string
          score_pct?: number | null
          started_at?: string
          student_id?: string
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_attempts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_attempts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_question_keys: {
        Row: {
          correct_answer: Json
          created_at: string
          question_id: string
          updated_at: string
        }
        Insert: {
          correct_answer: Json
          created_at?: string
          question_id: string
          updated_at?: string
        }
        Update: {
          correct_answer?: Json
          created_at?: string
          question_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_question_keys_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: true
            referencedRelation: "quiz_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_questions: {
        Row: {
          created_at: string
          id: string
          options: Json | null
          points: number
          question_ar: string
          question_en: string | null
          question_type: string
          quiz_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          options?: Json | null
          points?: number
          question_ar: string
          question_en?: string | null
          question_type: string
          quiz_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          options?: Json | null
          points?: number
          question_ar?: string
          question_en?: string | null
          question_type?: string
          quiz_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "quiz_questions_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
        ]
      }
      quizzes: {
        Row: {
          available_at: string | null
          course_id: string
          created_at: string
          created_by: string | null
          description_ar: string | null
          description_en: string | null
          due_at: string | null
          id: string
          is_published: boolean
          lesson_id: string | null
          passing_score_pct: number
          time_limit_minutes: number | null
          title_ar: string
          title_en: string | null
          updated_at: string
        }
        Insert: {
          available_at?: string | null
          course_id: string
          created_at?: string
          created_by?: string | null
          description_ar?: string | null
          description_en?: string | null
          due_at?: string | null
          id?: string
          is_published?: boolean
          lesson_id?: string | null
          passing_score_pct?: number
          time_limit_minutes?: number | null
          title_ar: string
          title_en?: string | null
          updated_at?: string
        }
        Update: {
          available_at?: string | null
          course_id?: string
          created_at?: string
          created_by?: string | null
          description_ar?: string | null
          description_en?: string | null
          due_at?: string | null
          id?: string
          is_published?: boolean
          lesson_id?: string | null
          passing_score_pct?: number
          time_limit_minutes?: number | null
          title_ar?: string
          title_en?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quizzes_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quizzes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quizzes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quizzes_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "course_lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      quran_surahs: {
        Row: {
          ayah_count: number
          juz_start: number | null
          surah_num: number
        }
        Insert: {
          ayah_count: number
          juz_start?: number | null
          surah_num: number
        }
        Update: {
          ayah_count?: number
          juz_start?: number | null
          surah_num?: number
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          bucket: string
          count: number
          identifier: string
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          identifier: string
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          identifier?: string
          window_start?: string
        }
        Relationships: []
      }
      recitation_errors: {
        Row: {
          ayah_num: number
          created_at: string
          error_type: string
          id: string
          note: string | null
          progress_id: string
          resolved: boolean
          resolved_at: string | null
          surah_num: number | null
        }
        Insert: {
          ayah_num: number
          created_at?: string
          error_type: string
          id?: string
          note?: string | null
          progress_id: string
          resolved?: boolean
          resolved_at?: string | null
          surah_num?: number | null
        }
        Update: {
          ayah_num?: number
          created_at?: string
          error_type?: string
          id?: string
          note?: string | null
          progress_id?: string
          resolved?: boolean
          resolved_at?: string | null
          surah_num?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recitation_errors_progress_id_fkey"
            columns: ["progress_id"]
            isOneToOne: false
            referencedRelation: "student_progress"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recitation_errors_progress_id_fkey"
            columns: ["progress_id"]
            isOneToOne: false
            referencedRelation: "v_progress"
            referencedColumns: ["progress_id"]
          },
        ]
      }
      refund_policies: {
        Row: {
          created_at: string
          description: string | null
          hours_before_max: number | null
          hours_before_min: number
          id: string
          is_active: boolean
          refund_percentage: number
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          hours_before_max?: number | null
          hours_before_min: number
          id?: string
          is_active?: boolean
          refund_percentage: number
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          hours_before_max?: number | null
          hours_before_min?: number
          id?: string
          is_active?: boolean
          refund_percentage?: number
          sort_order?: number
        }
        Relationships: []
      }
      remote_handoff_tokens: {
        Row: {
          admin_user_id: string
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          supabase_token_hash: string
          target_path: string
          used_at: string | null
          used_ip: unknown
          used_ua: string | null
        }
        Insert: {
          admin_user_id: string
          code_hash: string
          created_at?: string
          expires_at?: string
          id?: string
          supabase_token_hash: string
          target_path: string
          used_at?: string | null
          used_ip?: unknown
          used_ua?: string | null
        }
        Update: {
          admin_user_id?: string
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          supabase_token_hash?: string
          target_path?: string
          used_at?: string | null
          used_ip?: unknown
          used_ua?: string | null
        }
        Relationships: []
      }
      resource_assignments: {
        Row: {
          assigned_by: string
          created_at: string
          halaqa_id: string | null
          id: string
          resource_id: string
          student_id: string | null
        }
        Insert: {
          assigned_by: string
          created_at?: string
          halaqa_id?: string | null
          id?: string
          resource_id: string
          student_id?: string | null
        }
        Update: {
          assigned_by?: string
          created_at?: string
          halaqa_id?: string | null
          id?: string
          resource_id?: string
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resource_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_assignments_halaqa_id_fkey"
            columns: ["halaqa_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_assignments_halaqa_id_fkey"
            columns: ["halaqa_id"]
            isOneToOne: false
            referencedRelation: "v_sessions"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "resource_assignments_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      resources: {
        Row: {
          category: string
          created_at: string
          created_by_teacher_id: string | null
          description_ar: string | null
          description_en: string | null
          external_url: string | null
          file_url: string | null
          id: string
          is_published: boolean
          resource_type: string
          tags: string[]
          title_ar: string
          title_en: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          created_by_teacher_id?: string | null
          description_ar?: string | null
          description_en?: string | null
          external_url?: string | null
          file_url?: string | null
          id?: string
          is_published?: boolean
          resource_type: string
          tags?: string[]
          title_ar: string
          title_en?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          created_by_teacher_id?: string | null
          description_ar?: string | null
          description_en?: string | null
          external_url?: string | null
          file_url?: string | null
          id?: string
          is_published?: boolean
          resource_type?: string
          tags?: string[]
          title_ar?: string
          title_en?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resources_created_by_teacher_id_fkey"
            columns: ["created_by_teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_created_by_teacher_id_fkey"
            columns: ["created_by_teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_signals: {
        Row: {
          churn_risk_score: number | null
          computed_at: string
          created_at: string
          engagement_score: number | null
          id: string
          intervention_suggestion: string | null
          intervention_type: string | null
          last_booking_at: string | null
          last_intervention_at: string | null
          last_login_at: string | null
          last_session_at: string | null
          package_expires_at: string | null
          package_remaining: number | null
          risk_reason: string | null
          student_id: string
          weakness_json: Json | null
        }
        Insert: {
          churn_risk_score?: number | null
          computed_at?: string
          created_at?: string
          engagement_score?: number | null
          id?: string
          intervention_suggestion?: string | null
          intervention_type?: string | null
          last_booking_at?: string | null
          last_intervention_at?: string | null
          last_login_at?: string | null
          last_session_at?: string | null
          package_expires_at?: string | null
          package_remaining?: number | null
          risk_reason?: string | null
          student_id: string
          weakness_json?: Json | null
        }
        Update: {
          churn_risk_score?: number | null
          computed_at?: string
          created_at?: string
          engagement_score?: number | null
          id?: string
          intervention_suggestion?: string | null
          intervention_type?: string | null
          last_booking_at?: string | null
          last_intervention_at?: string | null
          last_login_at?: string | null
          last_session_at?: string | null
          package_expires_at?: string | null
          package_remaining?: number | null
          risk_reason?: string | null
          student_id?: string
          weakness_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "retention_signals_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retention_signals_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          booking_id: string
          comment: string | null
          created_at: string
          id: string
          is_public: boolean
          rating: number
          student_id: string
          teacher_id: string
          teacher_reply: string | null
        }
        Insert: {
          booking_id: string
          comment?: string | null
          created_at?: string
          id?: string
          is_public?: boolean
          rating: number
          student_id: string
          teacher_id: string
          teacher_reply?: string | null
        }
        Update: {
          booking_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          is_public?: boolean
          rating?: number
          student_id?: string
          teacher_id?: string
          teacher_reply?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "v_bookings"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "reviews_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      schema_migrations: {
        Row: {
          applied_at: string
          applied_by: string | null
          description: string | null
          version: string
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          description?: string | null
          version: string
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          description?: string | null
          version?: string
        }
        Relationships: []
      }
      security_alerts: {
        Row: {
          alert_level: string
          attempted_action: string
          created_at: string
          email: string | null
          id: string
          metadata: Json
          user_id: string | null
        }
        Insert: {
          alert_level: string
          attempted_action: string
          created_at?: string
          email?: string | null
          id?: string
          metadata?: Json
          user_id?: string | null
        }
        Update: {
          alert_level?: string
          attempted_action?: string
          created_at?: string
          email?: string | null
          id?: string
          metadata?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      services: {
        Row: {
          created_at: string | null
          description: string
          description_ar: string | null
          display_order: number | null
          features: string[] | null
          features_ar: string[] | null
          icon: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          title: string
          title_ar: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description: string
          description_ar?: string | null
          display_order?: number | null
          features?: string[] | null
          features_ar?: string[] | null
          icon?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          title: string
          title_ar?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string
          description_ar?: string | null
          display_order?: number | null
          features?: string[] | null
          features_ar?: string[] | null
          icon?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          title?: string
          title_ar?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      session_deliveries: {
        Row: {
          created_at: string
          delivered_at: string
          duration_minutes: number
          hourly_rate_usd: number
          id: string
          payroll_period_month: string
          session_id: string
          teacher_id: string
        }
        Insert: {
          created_at?: string
          delivered_at: string
          duration_minutes: number
          hourly_rate_usd: number
          id?: string
          payroll_period_month: string
          session_id: string
          teacher_id: string
        }
        Update: {
          created_at?: string
          delivered_at?: string
          duration_minutes?: number
          hourly_rate_usd?: number
          id?: string
          payroll_period_month?: string
          session_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_deliveries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_deliveries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "v_sessions"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "session_deliveries_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_deliveries_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      session_evaluations: {
        Row: {
          areas_for_improvement: string | null
          attendance_score: number | null
          created_at: string
          evaluation_date: string
          evaluation_type: Database["public"]["Enums"]["evaluation_type"]
          fluency_score: number | null
          hifz_score: number | null
          id: string
          next_goals: string | null
          overall_score: number | null
          strengths: string | null
          student_id: string
          tajweed_score: number | null
          teacher_comments: string | null
          teacher_id: string
        }
        Insert: {
          areas_for_improvement?: string | null
          attendance_score?: number | null
          created_at?: string
          evaluation_date?: string
          evaluation_type?: Database["public"]["Enums"]["evaluation_type"]
          fluency_score?: number | null
          hifz_score?: number | null
          id?: string
          next_goals?: string | null
          overall_score?: number | null
          strengths?: string | null
          student_id: string
          tajweed_score?: number | null
          teacher_comments?: string | null
          teacher_id: string
        }
        Update: {
          areas_for_improvement?: string | null
          attendance_score?: number | null
          created_at?: string
          evaluation_date?: string
          evaluation_type?: Database["public"]["Enums"]["evaluation_type"]
          fluency_score?: number | null
          hifz_score?: number | null
          id?: string
          next_goals?: string | null
          overall_score?: number | null
          strengths?: string | null
          student_id?: string
          tajweed_score?: number | null
          teacher_comments?: string | null
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_evaluations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_evaluations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_evaluations_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_evaluations_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      session_notes_history: {
        Row: {
          created_at: string | null
          id: string
          notes: string
          saved_by: string
          session_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          notes: string
          saved_by: string
          session_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          notes?: string
          saved_by?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_notes_history_saved_by_fkey"
            columns: ["saved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_notes_history_saved_by_fkey"
            columns: ["saved_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_notes_history_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_notes_history_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "v_sessions"
            referencedColumns: ["session_id"]
          },
        ]
      }
      session_observers: {
        Row: {
          created_at: string | null
          id: string
          joined_at: string | null
          left_at: string | null
          notes: string | null
          observer_id: string
          session_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          joined_at?: string | null
          left_at?: string | null
          notes?: string | null
          observer_id: string
          session_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          joined_at?: string | null
          left_at?: string | null
          notes?: string | null
          observer_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_observers_observer_id_fkey"
            columns: ["observer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_observers_observer_id_fkey"
            columns: ["observer_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_observers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_observers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "v_sessions"
            referencedColumns: ["session_id"]
          },
        ]
      }
      session_participants: {
        Row: {
          attendance_status: Database["public"]["Enums"]["attendance_status"]
          booking_id: string | null
          created_at: string
          daily_token: string | null
          id: string
          joined_at: string | null
          left_at: string | null
          notes: string | null
          role: Database["public"]["Enums"]["participant_role"]
          session_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attendance_status?: Database["public"]["Enums"]["attendance_status"]
          booking_id?: string | null
          created_at?: string
          daily_token?: string | null
          id?: string
          joined_at?: string | null
          left_at?: string | null
          notes?: string | null
          role: Database["public"]["Enums"]["participant_role"]
          session_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attendance_status?: Database["public"]["Enums"]["attendance_status"]
          booking_id?: string | null
          created_at?: string
          daily_token?: string | null
          id?: string
          joined_at?: string | null
          left_at?: string | null
          notes?: string | null
          role?: Database["public"]["Enums"]["participant_role"]
          session_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_participants_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_participants_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "session_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "v_sessions"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "session_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      session_presence_events: {
        Row: {
          client_info: Json | null
          created_at: string
          event_type: string
          id: string
          occurred_at: string
          session_id: string
          user_id: string
        }
        Insert: {
          client_info?: Json | null
          created_at?: string
          event_type: string
          id?: string
          occurred_at?: string
          session_id: string
          user_id: string
        }
        Update: {
          client_info?: Json | null
          created_at?: string
          event_type?: string
          id?: string
          occurred_at?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_presence_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_presence_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "v_sessions"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "session_presence_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_presence_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          actual_duration: number | null
          admin_observer_id: string | null
          allow_recording: boolean
          ayah_range: string | null
          booking_id: string | null
          capacity: number
          created_at: string
          created_via: string
          current_enrollment: number
          daily_room_mode: string
          ended_at: string | null
          expires_at: string | null
          external_lecture_url: string | null
          homework: string | null
          id: string
          is_group: boolean
          is_observable: boolean
          lesson_plan: Json | null
          min_participants: number
          observer_joined_at: string | null
          post_session_notes: string | null
          recording_url: string | null
          room_name: string
          room_url: string
          scheduled_at: string | null
          session_mode: Database["public"]["Enums"]["session_mode"]
          session_topic_ar: string | null
          session_topic_en: string | null
          started_at: string | null
          student_joined: boolean
          surah_reference: string | null
          teacher_joined: boolean
        }
        Insert: {
          actual_duration?: number | null
          admin_observer_id?: string | null
          allow_recording?: boolean
          ayah_range?: string | null
          booking_id?: string | null
          capacity?: number
          created_at?: string
          created_via?: string
          current_enrollment?: number
          daily_room_mode?: string
          ended_at?: string | null
          expires_at?: string | null
          external_lecture_url?: string | null
          homework?: string | null
          id?: string
          is_group?: boolean
          is_observable?: boolean
          lesson_plan?: Json | null
          min_participants?: number
          observer_joined_at?: string | null
          post_session_notes?: string | null
          recording_url?: string | null
          room_name?: string
          room_url: string
          scheduled_at?: string | null
          session_mode?: Database["public"]["Enums"]["session_mode"]
          session_topic_ar?: string | null
          session_topic_en?: string | null
          started_at?: string | null
          student_joined?: boolean
          surah_reference?: string | null
          teacher_joined?: boolean
        }
        Update: {
          actual_duration?: number | null
          admin_observer_id?: string | null
          allow_recording?: boolean
          ayah_range?: string | null
          booking_id?: string | null
          capacity?: number
          created_at?: string
          created_via?: string
          current_enrollment?: number
          daily_room_mode?: string
          ended_at?: string | null
          expires_at?: string | null
          external_lecture_url?: string | null
          homework?: string | null
          id?: string
          is_group?: boolean
          is_observable?: boolean
          lesson_plan?: Json | null
          min_participants?: number
          observer_joined_at?: string | null
          post_session_notes?: string | null
          recording_url?: string | null
          room_name?: string
          room_url?: string
          scheduled_at?: string | null
          session_mode?: Database["public"]["Enums"]["session_mode"]
          session_topic_ar?: string | null
          session_topic_en?: string | null
          started_at?: string | null
          student_joined?: boolean
          surah_reference?: string | null
          teacher_joined?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "sessions_admin_observer_id_fkey"
            columns: ["admin_observer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_admin_observer_id_fkey"
            columns: ["admin_observer_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "v_bookings"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      site_announcements: {
        Row: {
          active_from: string
          active_until: string | null
          created_at: string
          created_by: string | null
          cta_href: string | null
          cta_label_ar: string | null
          cta_label_en: string | null
          id: string
          is_dismissible: boolean
          message_ar: string
          message_en: string
          severity: string
          updated_at: string
        }
        Insert: {
          active_from?: string
          active_until?: string | null
          created_at?: string
          created_by?: string | null
          cta_href?: string | null
          cta_label_ar?: string | null
          cta_label_en?: string | null
          id?: string
          is_dismissible?: boolean
          message_ar: string
          message_en: string
          severity?: string
          updated_at?: string
        }
        Update: {
          active_from?: string
          active_until?: string | null
          created_at?: string
          created_by?: string | null
          cta_href?: string | null
          cta_label_ar?: string | null
          cta_label_en?: string | null
          id?: string
          is_dismissible?: boolean
          message_ar?: string
          message_en?: string
          severity?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      site_blog_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          key: string
          label_ar: string
          label_en: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          label_ar: string
          label_en: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          label_ar?: string
          label_en?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      site_faqs: {
        Row: {
          answer_ar: string
          answer_en: string
          created_at: string
          id: string
          is_active: boolean
          question_ar: string
          question_en: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          answer_ar: string
          answer_en: string
          created_at?: string
          id?: string
          is_active?: boolean
          question_ar: string
          question_en: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          answer_ar?: string
          answer_en?: string
          created_at?: string
          id?: string
          is_active?: boolean
          question_ar?: string
          question_en?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      site_features: {
        Row: {
          created_at: string
          description_ar: string | null
          description_en: string | null
          icon_name: string
          id: string
          is_active: boolean
          meta: Json
          slot: string
          sort_order: number
          title_ar: string
          title_en: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          icon_name: string
          id?: string
          is_active?: boolean
          meta?: Json
          slot: string
          sort_order?: number
          title_ar: string
          title_en: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          icon_name?: string
          id?: string
          is_active?: boolean
          meta?: Json
          slot?: string
          sort_order?: number
          title_ar?: string
          title_en?: string
          updated_at?: string
        }
        Relationships: []
      }
      stripe_customers: {
        Row: {
          created_at: string
          id: string
          stripe_customer_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          stripe_customer_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          stripe_customer_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_customers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_customers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_goals: {
        Row: {
          ayah_end: number
          ayah_start: number
          created_at: string
          id: string
          student_id: string
          surah_end: number
          surah_start: number
          target_date: string
          updated_at: string
        }
        Insert: {
          ayah_end: number
          ayah_start: number
          created_at?: string
          id?: string
          student_id: string
          surah_end: number
          surah_start: number
          target_date: string
          updated_at?: string
        }
        Update: {
          ayah_end?: number
          ayah_start?: number
          created_at?: string
          id?: string
          student_id?: string
          surah_end?: number
          surah_start?: number
          target_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      student_ijazah_progress: {
        Row: {
          completed_at: string | null
          created_at: string
          enrolled_at: string
          id: string
          issued_certificate_url: string | null
          issuing_teacher_id: string | null
          notes: string | null
          pathway_id: string
          student_id: string
          target_completion_at: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          enrolled_at?: string
          id?: string
          issued_certificate_url?: string | null
          issuing_teacher_id?: string | null
          notes?: string | null
          pathway_id: string
          student_id: string
          target_completion_at?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          enrolled_at?: string
          id?: string
          issued_certificate_url?: string | null
          issuing_teacher_id?: string | null
          notes?: string | null
          pathway_id?: string
          student_id?: string
          target_completion_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_ijazah_progress_issuing_teacher_id_fkey"
            columns: ["issuing_teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_ijazah_progress_issuing_teacher_id_fkey"
            columns: ["issuing_teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_ijazah_progress_pathway_id_fkey"
            columns: ["pathway_id"]
            isOneToOne: false
            referencedRelation: "ijazah_pathways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_ijazah_progress_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_ijazah_progress_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_ijazah_requirement_progress: {
        Row: {
          created_at: string
          id: string
          met_at: string | null
          notes: string | null
          requirement_id: string
          student_progress_id: string
          updated_at: string
          verifying_teacher_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          met_at?: string | null
          notes?: string | null
          requirement_id: string
          student_progress_id: string
          updated_at?: string
          verifying_teacher_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          met_at?: string | null
          notes?: string | null
          requirement_id?: string
          student_progress_id?: string
          updated_at?: string
          verifying_teacher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_ijazah_requirement_progress_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "ijazah_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_ijazah_requirement_progress_student_progress_id_fkey"
            columns: ["student_progress_id"]
            isOneToOne: false
            referencedRelation: "student_ijazah_progress"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_ijazah_requirement_progress_verifying_teacher_id_fkey"
            columns: ["verifying_teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_ijazah_requirement_progress_verifying_teacher_id_fkey"
            columns: ["verifying_teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_packages: {
        Row: {
          billing_cycle_key: string | null
          cancel_reason_code:
            | Database["public"]["Enums"]["booking_cancel_reason_code"]
            | null
          cancel_reason_detail: string | null
          created_at: string
          expires_at: string | null
          id: string
          package_id: string | null
          payment_id: string | null
          payment_provider: string
          product_type: string
          provider_payment_ref: string | null
          purchased_at: string
          rate_paid_usd: number | null
          session_mode_used: Json
          sessions_remaining: number | null
          sessions_total: number
          sessions_used: number
          status: string
          stripe_payment_intent_id: string | null
          student_id: string
          subscription_id: string | null
        }
        Insert: {
          billing_cycle_key?: string | null
          cancel_reason_code?:
            | Database["public"]["Enums"]["booking_cancel_reason_code"]
            | null
          cancel_reason_detail?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          package_id?: string | null
          payment_id?: string | null
          payment_provider?: string
          product_type?: string
          provider_payment_ref?: string | null
          purchased_at?: string
          rate_paid_usd?: number | null
          session_mode_used?: Json
          sessions_remaining?: number | null
          sessions_total: number
          sessions_used?: number
          status?: string
          stripe_payment_intent_id?: string | null
          student_id: string
          subscription_id?: string | null
        }
        Update: {
          billing_cycle_key?: string | null
          cancel_reason_code?:
            | Database["public"]["Enums"]["booking_cancel_reason_code"]
            | null
          cancel_reason_detail?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          package_id?: string | null
          payment_id?: string | null
          payment_provider?: string
          product_type?: string
          provider_payment_ref?: string | null
          purchased_at?: string
          rate_paid_usd?: number | null
          session_mode_used?: Json
          sessions_remaining?: number | null
          sessions_total?: number
          sessions_used?: number
          status?: string
          stripe_payment_intent_id?: string | null
          student_id?: string
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_packages_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_packages_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_packages_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_packages_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_packages_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      student_progress: {
        Row: {
          ayah_from: number | null
          ayah_to: number | null
          booking_id: string
          created_at: string
          id: string
          level: Database["public"]["Enums"]["student_level"]
          pages_reviewed: number | null
          progress_type: string
          quality_rating: number | null
          recitation_standard: string | null
          student_id: string
          surah_from: number | null
          surah_to: number | null
          teacher_id: string
          teacher_notes: string | null
        }
        Insert: {
          ayah_from?: number | null
          ayah_to?: number | null
          booking_id: string
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["student_level"]
          pages_reviewed?: number | null
          progress_type?: string
          quality_rating?: number | null
          recitation_standard?: string | null
          student_id: string
          surah_from?: number | null
          surah_to?: number | null
          teacher_id: string
          teacher_notes?: string | null
        }
        Update: {
          ayah_from?: number | null
          ayah_to?: number | null
          booking_id?: string
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["student_level"]
          pages_reviewed?: number | null
          progress_type?: string
          quality_rating?: number | null
          recitation_standard?: string | null
          student_id?: string
          surah_from?: number | null
          surah_to?: number | null
          teacher_id?: string
          teacher_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_progress_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_progress_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "student_progress_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_progress_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_progress_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_progress_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_review_schedule: {
        Row: {
          algorithm_version: number
          batch_for_date: string | null
          created_at: string
          easiness_factor: number
          id: string
          interval_days: number
          lapse_count: number
          last_reviewed_at: string | null
          next_review_at: string
          progress_id: string
          student_id: string
          updated_at: string
        }
        Insert: {
          algorithm_version?: number
          batch_for_date?: string | null
          created_at?: string
          easiness_factor?: number
          id?: string
          interval_days?: number
          lapse_count?: number
          last_reviewed_at?: string | null
          next_review_at: string
          progress_id: string
          student_id: string
          updated_at?: string
        }
        Update: {
          algorithm_version?: number
          batch_for_date?: string | null
          created_at?: string
          easiness_factor?: number
          id?: string
          interval_days?: number
          lapse_count?: number
          last_reviewed_at?: string | null
          next_review_at?: string
          progress_id?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_review_schedule_progress_id_fkey"
            columns: ["progress_id"]
            isOneToOne: false
            referencedRelation: "student_progress"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_review_schedule_progress_id_fkey"
            columns: ["progress_id"]
            isOneToOne: false
            referencedRelation: "v_progress"
            referencedColumns: ["progress_id"]
          },
        ]
      }
      study_log: {
        Row: {
          created_at: string
          duration_seconds: number
          ended_at: string | null
          id: string
          kind: string
          notes: string | null
          started_at: string
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_seconds?: number
          ended_at?: string | null
          id?: string
          kind?: string
          notes?: string | null
          started_at: string
          student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_seconds?: number
          ended_at?: string | null
          id?: string
          kind?: string
          notes?: string | null
          started_at?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_log_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_log_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_discount_records: {
        Row: {
          applied_at: string
          discount_pct: number
          discount_type: string
          id: string
          setting_key: string
          subscription_id: string
        }
        Insert: {
          applied_at?: string
          discount_pct: number
          discount_type: string
          id?: string
          setting_key: string
          subscription_id: string
        }
        Update: {
          applied_at?: string
          discount_pct?: number
          discount_type?: string
          id?: string
          setting_key?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_discount_records_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_extensions: {
        Row: {
          booking_id: string
          extension_seconds: number
          granted_at: string
          granted_by_user_id: string
          id: string
          reason: string
          session_id: string | null
          subscription_id: string
        }
        Insert: {
          booking_id: string
          extension_seconds: number
          granted_at?: string
          granted_by_user_id: string
          id?: string
          reason: string
          session_id?: string | null
          subscription_id: string
        }
        Update: {
          booking_id?: string
          extension_seconds?: number
          granted_at?: string
          granted_by_user_id?: string
          id?: string
          reason?: string
          session_id?: string | null
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_extensions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_extensions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "subscription_extensions_granted_by_user_id_fkey"
            columns: ["granted_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_extensions_granted_by_user_id_fkey"
            columns: ["granted_by_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_extensions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_extensions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "v_sessions"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "subscription_extensions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          created_at: string
          currency: string
          id: string
          is_active: boolean
          is_hifz_product: boolean
          monthly_credit_count: number
          name: string
          plan_code: string
          plan_type: Database["public"]["Enums"]["billing_plan_type"]
          price_cents: number
          session_duration_min: number | null
          session_metadata: Json
          sessions_per_month: number | null
          stripe_price_id: string
          stripe_product_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          is_hifz_product?: boolean
          monthly_credit_count: number
          name: string
          plan_code: string
          plan_type: Database["public"]["Enums"]["billing_plan_type"]
          price_cents: number
          session_duration_min?: number | null
          session_metadata?: Json
          sessions_per_month?: number | null
          stripe_price_id: string
          stripe_product_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          is_hifz_product?: boolean
          monthly_credit_count?: number
          name?: string
          plan_code?: string
          plan_type?: Database["public"]["Enums"]["billing_plan_type"]
          price_cents?: number
          session_duration_min?: number | null
          session_metadata?: Json
          sessions_per_month?: number | null
          stripe_price_id?: string
          stripe_product_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscription_teacher_assignments: {
        Row: {
          approved_by: string | null
          cancelled_future_bookings_at: string | null
          created_at: string
          id: string
          is_active: boolean
          lock_month: string
          product_type: string
          student_id: string
          subscription_id: string
          teacher_id: string
          updated_at: string
        }
        Insert: {
          approved_by?: string | null
          cancelled_future_bookings_at?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          lock_month: string
          product_type: string
          student_id: string
          subscription_id: string
          teacher_id: string
          updated_at?: string
        }
        Update: {
          approved_by?: string | null
          cancelled_future_bookings_at?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          lock_month?: string
          product_type?: string
          student_id?: string
          subscription_id?: string
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_teacher_assignments_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_teacher_assignments_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_teacher_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_teacher_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_teacher_assignments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_teacher_assignments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_teacher_assignments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      single_session_refund_requests: {
        Row: {
          amount_usd: number
          booking_id: string
          created_at: string
          id: string
          resolved_at: string | null
          status: string
          stripe_payment_intent: string
          stripe_refund_id: string | null
        }
        Insert: {
          amount_usd: number
          booking_id: string
          created_at?: string
          id: string
          resolved_at?: string | null
          status?: string
          stripe_payment_intent: string
          stripe_refund_id?: string | null
        }
        Update: {
          amount_usd?: number
          booking_id?: string
          created_at?: string
          id?: string
          resolved_at?: string | null
          status?: string
          stripe_payment_intent?: string
          stripe_refund_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "single_session_refund_requests_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "single_session_refund_requests_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          is_hifz: boolean
          last_event_at: string
          payer_user_id: string | null
          pending_tier_change_id: string | null
          plan_id: string
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id: string
          stripe_subscription_id: string
          student_id: string
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          is_hifz?: boolean
          last_event_at?: string
          payer_user_id?: string | null
          pending_tier_change_id?: string | null
          plan_id: string
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id: string
          stripe_subscription_id: string
          student_id: string
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          is_hifz?: boolean
          last_event_at?: string
          payer_user_id?: string | null
          pending_tier_change_id?: string | null
          plan_id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string
          stripe_subscription_id?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_subscriptions_pending_tier_change"
            columns: ["pending_tier_change_id", "id"]
            isOneToOne: false
            referencedRelation: "pending_tier_changes"
            referencedColumns: ["id", "subscription_id"]
          },
          {
            foreignKeyName: "subscriptions_payer_user_id_fkey"
            columns: ["payer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_payer_user_id_fkey"
            columns: ["payer_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_availability: {
        Row: {
          day_of_week: number
          end_time: string
          id: string
          is_active: boolean
          slot_duration: number
          start_time: string
          teacher_id: string
        }
        Insert: {
          day_of_week: number
          end_time: string
          id?: string
          is_active?: boolean
          slot_duration?: number
          start_time: string
          teacher_id: string
        }
        Update: {
          day_of_week?: number
          end_time?: string
          id?: string
          is_active?: boolean
          slot_duration?: number
          start_time?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_availability_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_availability_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_availability_instances: {
        Row: {
          created_at: string
          end_time: string
          id: string
          is_booked: boolean
          slot_date: string
          start_time: string
          teacher_id: string
          template_id: string
        }
        Insert: {
          created_at?: string
          end_time: string
          id?: string
          is_booked?: boolean
          slot_date: string
          start_time: string
          teacher_id: string
          template_id: string
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: string
          is_booked?: boolean
          slot_date?: string
          start_time?: string
          teacher_id?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_availability_instances_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_availability_instances_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_availability_instances_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "teacher_availability"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_ijaza: {
        Row: {
          chain_text: string
          created_at: string
          document_url: string | null
          granted_at: string | null
          granted_by: string | null
          id: string
          riwaya: string
          teacher_id: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          chain_text: string
          created_at?: string
          document_url?: string | null
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          riwaya: string
          teacher_id: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          chain_text?: string
          created_at?: string
          document_url?: string | null
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          riwaya?: string
          teacher_id?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teacher_ijaza_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_ijaza_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_ijaza_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_ijaza_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_languages: {
        Row: {
          created_at: string
          is_active: boolean
          key: string
          label_ar: string
          label_en: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          is_active?: boolean
          key: string
          label_ar: string
          label_en: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          is_active?: boolean
          key?: string
          label_ar?: string
          label_en?: string
          sort_order?: number
        }
        Relationships: []
      }
      teacher_mentorship_feedback: {
        Row: {
          created_at: string
          feedback_text: string
          id: string
          mentorship_id: string
          session_id: string | null
          severity: string
          written_by: string
        }
        Insert: {
          created_at?: string
          feedback_text: string
          id?: string
          mentorship_id: string
          session_id?: string | null
          severity?: string
          written_by: string
        }
        Update: {
          created_at?: string
          feedback_text?: string
          id?: string
          mentorship_id?: string
          session_id?: string | null
          severity?: string
          written_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_mentorship_feedback_mentorship_id_fkey"
            columns: ["mentorship_id"]
            isOneToOne: false
            referencedRelation: "teacher_mentorships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_mentorship_feedback_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_mentorship_feedback_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "v_sessions"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "teacher_mentorship_feedback_written_by_fkey"
            columns: ["written_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_mentorship_feedback_written_by_fkey"
            columns: ["written_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_mentorships: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          mentee_id: string
          mentor_id: string
          notes: string | null
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          mentee_id: string
          mentor_id: string
          notes?: string | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          mentee_id?: string
          mentor_id?: string
          notes?: string | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_mentorships_mentee_id_fkey"
            columns: ["mentee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_mentorships_mentee_id_fkey"
            columns: ["mentee_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_mentorships_mentor_id_fkey"
            columns: ["mentor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_mentorships_mentor_id_fkey"
            columns: ["mentor_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_notes: {
        Row: {
          content: string
          created_at: string
          id: string
          student_id: string
          teacher_id: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          student_id: string
          teacher_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          student_id?: string
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_notes_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_notes_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_notes_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_notes_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_earning_entries: {
        Row: {
          agreement_version: string | null
          amount_cents: number
          claimed_at: string | null
          consuming_entry_id: string | null
          created_at: string
          external_reference_id: string | null
          funding_charge_id: string | null
          hold_reason: string | null
          id: string
          kind: Database["public"]["Enums"]["earning_entry_kind"]
          payment_id: string | null
          recovered_against_entry_id: string | null
          reverses_recovery_id: string | null
          session_delivery_id: string | null
          settled_at: string | null
          settled_by: string | null
          status: Database["public"]["Enums"]["earning_entry_status"]
          teacher_id: string
          transfer_group: string | null
          updated_at: string
        }
        Insert: {
          agreement_version?: string | null
          amount_cents: number
          claimed_at?: string | null
          consuming_entry_id?: string | null
          created_at?: string
          external_reference_id?: string | null
          funding_charge_id?: string | null
          hold_reason?: string | null
          id?: string
          kind: Database["public"]["Enums"]["earning_entry_kind"]
          payment_id?: string | null
          recovered_against_entry_id?: string | null
          reverses_recovery_id?: string | null
          session_delivery_id?: string | null
          settled_at?: string | null
          settled_by?: string | null
          status?: Database["public"]["Enums"]["earning_entry_status"]
          teacher_id: string
          transfer_group?: string | null
          updated_at?: string
        }
        Update: {
          agreement_version?: string | null
          amount_cents?: number
          claimed_at?: string | null
          consuming_entry_id?: string | null
          created_at?: string
          external_reference_id?: string | null
          funding_charge_id?: string | null
          hold_reason?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["earning_entry_kind"]
          payment_id?: string | null
          recovered_against_entry_id?: string | null
          reverses_recovery_id?: string | null
          session_delivery_id?: string | null
          settled_at?: string | null
          settled_by?: string | null
          status?: Database["public"]["Enums"]["earning_entry_status"]
          teacher_id?: string
          transfer_group?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_earning_entries_consuming_entry_id_fkey"
            columns: ["consuming_entry_id"]
            isOneToOne: false
            referencedRelation: "teacher_earning_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_earning_entries_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_earning_entries_recovered_against_entry_id_fkey"
            columns: ["recovered_against_entry_id"]
            isOneToOne: false
            referencedRelation: "teacher_earning_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_earning_entries_reverses_recovery_id_fkey"
            columns: ["reverses_recovery_id"]
            isOneToOne: false
            referencedRelation: "teacher_earning_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_earning_entries_session_delivery_id_fkey"
            columns: ["session_delivery_id"]
            isOneToOne: false
            referencedRelation: "session_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_earning_entries_settled_by_fkey"
            columns: ["settled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_earning_entries_settled_by_fkey"
            columns: ["settled_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_earning_entries_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_earning_entries_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_payouts: {
        Row: {
          created_at: string
          hourly_rate_usd: number
          id: string
          payroll_period_month: string
          run_at: string
          status: Database["public"]["Enums"]["payout_status"]
          teacher_id: string
          total_amount_usd: number
          total_hours: number
        }
        Insert: {
          created_at?: string
          hourly_rate_usd: number
          id?: string
          payroll_period_month: string
          run_at?: string
          status?: Database["public"]["Enums"]["payout_status"]
          teacher_id: string
          total_amount_usd: number
          total_hours: number
        }
        Update: {
          created_at?: string
          hourly_rate_usd?: number
          id?: string
          payroll_period_month?: string
          run_at?: string
          status?: Database["public"]["Enums"]["payout_status"]
          teacher_id?: string
          total_amount_usd?: number
          total_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "teacher_payouts_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_payouts_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_transfers: {
        Row: {
          amount_cents: number
          created_at: string
          entry_id: string
          error_detail: string | null
          id: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["teacher_transfer_kind"]
          session_delivery_id: string | null
          status: Database["public"]["Enums"]["teacher_transfer_status"]
          stripe_transfer_id: string | null
          teacher_id: string
          transfer_group: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          entry_id: string
          error_detail?: string | null
          id?: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["teacher_transfer_kind"]
          session_delivery_id?: string | null
          status?: Database["public"]["Enums"]["teacher_transfer_status"]
          stripe_transfer_id?: string | null
          teacher_id: string
          transfer_group?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          entry_id?: string
          error_detail?: string | null
          id?: string
          idempotency_key?: string
          kind?: Database["public"]["Enums"]["teacher_transfer_kind"]
          session_delivery_id?: string | null
          status?: Database["public"]["Enums"]["teacher_transfer_status"]
          stripe_transfer_id?: string | null
          teacher_id?: string
          transfer_group?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_transfers_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "teacher_earning_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_transfers_session_delivery_id_fkey"
            columns: ["session_delivery_id"]
            isOneToOne: false
            referencedRelation: "session_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_transfers_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_transfers_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_profiles: {
        Row: {
          archived_at: string | null
          bio: string | null
          bio_en: string | null
          created_at: string
          cv_rejection_reason: string | null
          cv_reviewed_at: string | null
          cv_reviewed_by: string | null
          cv_status: Database["public"]["Enums"]["cv_status"]
          cv_submitted_at: string | null
          gender: Database["public"]["Enums"]["gender_type"] | null
          hourly_rate: number
          id: string
          intro_video_url: string | null
          is_accepting: boolean
          is_archived: boolean
          languages: string[]
          max_active_students: number | null
          rating_avg: number
          recitation_standards: string[]
          search_vector: unknown
          specialties: string[]
          teacher_id: string
          total_sessions: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          bio?: string | null
          bio_en?: string | null
          created_at?: string
          cv_rejection_reason?: string | null
          cv_reviewed_at?: string | null
          cv_reviewed_by?: string | null
          cv_status?: Database["public"]["Enums"]["cv_status"]
          cv_submitted_at?: string | null
          gender?: Database["public"]["Enums"]["gender_type"] | null
          hourly_rate: number
          id?: string
          intro_video_url?: string | null
          is_accepting?: boolean
          is_archived?: boolean
          languages?: string[]
          max_active_students?: number | null
          rating_avg?: number
          recitation_standards?: string[]
          search_vector?: unknown
          specialties?: string[]
          teacher_id: string
          total_sessions?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          bio?: string | null
          bio_en?: string | null
          created_at?: string
          cv_rejection_reason?: string | null
          cv_reviewed_at?: string | null
          cv_reviewed_by?: string | null
          cv_status?: Database["public"]["Enums"]["cv_status"]
          cv_submitted_at?: string | null
          gender?: Database["public"]["Enums"]["gender_type"] | null
          hourly_rate?: number
          id?: string
          intro_video_url?: string | null
          is_accepting?: boolean
          is_archived?: boolean
          languages?: string[]
          max_active_students?: number | null
          rating_avg?: number
          recitation_standards?: string[]
          search_vector?: unknown
          specialties?: string[]
          teacher_id?: string
          total_sessions?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_profiles_cv_reviewed_by_fkey"
            columns: ["cv_reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_profiles_cv_reviewed_by_fkey"
            columns: ["cv_reviewed_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_profiles_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_profiles_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: true
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_recitations: {
        Row: {
          created_at: string
          is_active: boolean
          key: string
          label_ar: string
          label_en: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          is_active?: boolean
          key: string
          label_ar: string
          label_en: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          is_active?: boolean
          key?: string
          label_ar?: string
          label_en?: string
          sort_order?: number
        }
        Relationships: []
      }
      teacher_specialties: {
        Row: {
          created_at: string
          is_active: boolean
          key: string
          label_ar: string
          label_en: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          is_active?: boolean
          key: string
          label_ar: string
          label_en: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          is_active?: boolean
          key?: string
          label_ar?: string
          label_en?: string
          sort_order?: number
        }
        Relationships: []
      }
      testimonials: {
        Row: {
          author_location: string | null
          author_name: string
          created_at: string
          display_order: number
          id: string
          is_published: boolean
          quote_ar: string
          quote_en: string | null
          teacher_id: string | null
        }
        Insert: {
          author_location?: string | null
          author_name: string
          created_at?: string
          display_order?: number
          id?: string
          is_published?: boolean
          quote_ar: string
          quote_en?: string | null
          teacher_id?: string | null
        }
        Update: {
          author_location?: string | null
          author_name?: string
          created_at?: string
          display_order?: number
          id?: string
          is_published?: boolean
          quote_ar?: string
          quote_en?: string | null
          teacher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "testimonials_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teacher_profiles"
            referencedColumns: ["teacher_id"]
          },
          {
            foreignKeyName: "testimonials_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "v_teachers"
            referencedColumns: ["teacher_id"]
          },
        ]
      }
    }
    Views: {
      public_profiles: {
        Row: {
          avatar_url: string | null
          full_name: string | null
          full_name_ar: string | null
          id: string | null
          role: Database["public"]["Enums"]["user_role"] | null
        }
        Insert: {
          avatar_url?: string | null
          full_name?: string | null
          full_name_ar?: string | null
          id?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
        }
        Update: {
          avatar_url?: string | null
          full_name?: string | null
          full_name_ar?: string | null
          id?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
        }
        Relationships: []
      }
      v_bookings: {
        Row: {
          booking_id: string | null
          created_at: string | null
          duration_min: number | null
          notes: string | null
          scheduled_at: string | null
          session_type: Database["public"]["Enums"]["session_type"] | null
          status: Database["public"]["Enums"]["booking_status"] | null
          student_id: string | null
          student_name: string | null
          student_package_id: string | null
          teacher_id: string | null
          teacher_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_student_package_id_fkey"
            columns: ["student_package_id"]
            isOneToOne: false
            referencedRelation: "student_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_student_package_id_fkey"
            columns: ["student_package_id"]
            isOneToOne: false
            referencedRelation: "v_package_effective_status"
            referencedColumns: ["student_package_id"]
          },
          {
            foreignKeyName: "bookings_student_package_id_fkey"
            columns: ["student_package_id"]
            isOneToOne: false
            referencedRelation: "v_student_packages"
            referencedColumns: ["student_package_id"]
          },
          {
            foreignKeyName: "bookings_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_evaluations: {
        Row: {
          areas_for_improvement: string | null
          attendance_score: number | null
          created_at: string | null
          evaluation_date: string | null
          evaluation_id: string | null
          evaluation_type: Database["public"]["Enums"]["evaluation_type"] | null
          fluency_score: number | null
          hifz_score: number | null
          next_goals: string | null
          overall_score: number | null
          strengths: string | null
          student_id: string | null
          student_name: string | null
          tajweed_score: number | null
          teacher_comments: string | null
          teacher_id: string | null
          teacher_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_evaluations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_evaluations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_evaluations_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_evaluations_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_homework: {
        Row: {
          assigned_at: string | null
          ayah_end: number | null
          ayah_start: number | null
          booking_id: string | null
          completed_at: string | null
          created_at: string | null
          due_date: string | null
          homework_id: string | null
          homework_type: Database["public"]["Enums"]["homework_type"] | null
          pages_count: number | null
          parent_assignment_id: string | null
          ready_at: string | null
          status: Database["public"]["Enums"]["homework_status"] | null
          student_id: string | null
          student_name: string | null
          surah_number: number | null
          teacher_id: string | null
          teacher_name: string | null
          teacher_notes: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "homework_assignments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "homework_assignments_parent_assignment_id_fkey"
            columns: ["parent_assignment_id"]
            isOneToOne: false
            referencedRelation: "homework_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_parent_assignment_id_fkey"
            columns: ["parent_assignment_id"]
            isOneToOne: false
            referencedRelation: "v_homework"
            referencedColumns: ["homework_id"]
          },
          {
            foreignKeyName: "homework_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_package_effective_status: {
        Row: {
          created_at: string | null
          effective_status: string | null
          expires_at: string | null
          package_id: string | null
          payment_id: string | null
          purchased_at: string | null
          sessions_remaining: number | null
          sessions_total: number | null
          sessions_used: number | null
          student_id: string | null
          student_package_id: string | null
        }
        Insert: {
          created_at?: string | null
          effective_status?: never
          expires_at?: string | null
          package_id?: string | null
          payment_id?: string | null
          purchased_at?: string | null
          sessions_remaining?: never
          sessions_total?: number | null
          sessions_used?: number | null
          student_id?: string | null
          student_package_id?: string | null
        }
        Update: {
          created_at?: string | null
          effective_status?: never
          expires_at?: string | null
          package_id?: string | null
          payment_id?: string | null
          purchased_at?: string | null
          sessions_remaining?: never
          sessions_total?: number | null
          sessions_used?: number | null
          student_id?: string | null
          student_package_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_packages_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_packages_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_packages_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_packages_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_progress: {
        Row: {
          ayah_from: number | null
          ayah_to: number | null
          booking_id: string | null
          created_at: string | null
          level: Database["public"]["Enums"]["student_level"] | null
          pages_reviewed: number | null
          progress_id: string | null
          progress_type: string | null
          quality_rating: number | null
          student_id: string | null
          student_name: string | null
          surah_from: number | null
          surah_to: number | null
          teacher_id: string | null
          teacher_name: string | null
          teacher_notes: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_progress_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_progress_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "student_progress_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_progress_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_progress_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_progress_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_sessions: {
        Row: {
          actual_duration: number | null
          booking_id: string | null
          created_at: string | null
          created_via: string | null
          ended_at: string | null
          is_observable: boolean | null
          room_name: string | null
          room_url: string | null
          session_id: string | null
          started_at: string | null
          student_joined: boolean | null
          student_name: string | null
          teacher_joined: boolean | null
          teacher_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "v_bookings"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      v_student_packages: {
        Row: {
          created_at: string | null
          expires_at: string | null
          package_id: string | null
          package_name_ar: string | null
          package_name_en: string | null
          package_type: string | null
          payment_id: string | null
          purchased_at: string | null
          sessions_remaining: number | null
          sessions_total: number | null
          sessions_used: number | null
          status: string | null
          student_id: string | null
          student_name: string | null
          student_package_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_packages_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_packages_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_packages_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_packages_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_teachers: {
        Row: {
          bio: string | null
          bio_en: string | null
          created_at: string | null
          cv_reviewed_at: string | null
          cv_status: Database["public"]["Enums"]["cv_status"] | null
          full_name: string | null
          full_name_ar: string | null
          gender: Database["public"]["Enums"]["gender_type"] | null
          hourly_rate: number | null
          intro_video_url: string | null
          is_accepting: boolean | null
          is_archived: boolean | null
          phone: string | null
          rating_avg: number | null
          recitation_standards: string[] | null
          specialties: string[] | null
          teacher_id: string | null
          total_sessions: number | null
        }
        Relationships: [
          {
            foreignKeyName: "teacher_profiles_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_profiles_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: true
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      ai_review_gate: {
        Args: { p_workflow_name: string }
        Returns: {
          approved_count: number
          total_reviewed: number
        }[]
      }
      booking_end_ts: { Args: { mins: number; ts: string }; Returns: string }
      check_and_increment_rate_limit: {
        Args: {
          p_bucket: string
          p_identifier: string
          p_max: number
          p_window_seconds: number
        }
        Returns: boolean
      }
      complete_review: {
        Args: {
          p_easiness: number
          p_interval_days: number
          p_schedule_id: string
        }
        Returns: {
          easiness_factor: number
          interval_days: number
          next_review_at: string
        }[]
      }
      compute_honor_board: {
        Args: { p_rank_period: string }
        Returns: undefined
      }
      compute_murajaah_batch_for_date: {
        Args: { p_date: string }
        Returns: {
          rows_scheduled: number
          students_processed: number
        }[]
      }
      finalize_single_session_refund: {
        Args: { p_refund_request_id: string; p_stripe_ref: string }
        Returns: Json
      }
      reconcile_external_single_session_refund: {
        Args: { p_payment_intent: string }
        Returns: Json
      }
      release_single_session_refund: {
        Args: { p_refund_request_id: string }
        Returns: undefined
      }
      reserve_single_session_refund: {
        Args: { p_booking: string; p_refund_request_id: string }
        Returns: number
      }
      confirm_booking_with_session: {
        Args: {
          p_booking_id: string
          p_expires_at: string
          p_room_name: string
          p_room_url: string
        }
        Returns: string
      }
      create_single_session_booking: {
        Args: {
          p_booking_product_type: string
          p_payment_id?: string
          p_purpose?: Database["public"]["Enums"]["specialized_purpose"]
          p_specialty?: string
          p_student_id: string
          p_target_scope?: Json
          p_teacher_id: string
        }
        Returns: string
      }
      deduct_package_session: {
        Args: { p_package_id: string }
        Returns: boolean
      }
      deduct_package_session_mode: {
        Args: { p_mode: string; p_package_id: string }
        Returns: {
          deducted: boolean
          used_legacy: boolean
        }[]
      }
      end_session_from_webhook: {
        Args: {
          p_duration_min: number
          p_duration_seconds: number
          p_ended_at: string
          p_event_id: string
          p_event_type: string
          p_payload_json: Json
          p_room_name: string
          p_session_id: string
        }
        Returns: {
          booking_id: string
          is_duplicate: boolean
          is_reconcile: boolean
          status_outcome: string
          student_id: string
          teacher_id: string
        }[]
      }
      end_session_with_booking: {
        Args: { p_actual_duration: number; p_session_id: string }
        Returns: string
      }
      finalize_attendance: {
        Args: {
          p_actual_teacher_id?: string
          p_booking_id: string
          p_outcome: Database["public"]["Enums"]["attendance_outcome"]
        }
        Returns: undefined
      }
      finalize_prepaid_refund: {
        Args: { p_refund_request_id: string; p_stripe_ref?: string }
        Returns: undefined
      }
      get_public_teacher: {
        Args: { p_id: string }
        Returns: {
          avatar_url: string
          bio: string
          bio_en: string
          full_name: string
          full_name_ar: string
          gender: string
          hourly_rate: number
          id: string
          languages: string[]
          rating_avg: number
          rating_count: number
          recitation_standards: string[]
          specialties: string[]
          total_sessions: number
        }[]
      }
      get_teacher_overdue_eval_count: {
        Args: { p_teacher_id: string }
        Returns: number
      }
      get_user_id_by_email: { Args: { p_email: string }; Returns: string }
      grant_hifz_cycle_credits: {
        Args: {
          p_billing_cycle_key: string
          p_plan_id: string
          p_session_count?: number
          p_subscription_id: string
        }
        Returns: string
      }
      grant_prepaid_hours: {
        Args: {
          p_hours: number
          p_payment_intent: string
          p_provider?: string
          p_rate: number
          p_student: string
        }
        Returns: string
      }
      grant_subscription_cycle: {
        Args: {
          p_amount_cents: number
          p_credit_count: number
          p_cycle_key: string
          p_expires_at: string
          p_plan_id: string
          p_session_metadata: Json
          p_stripe_payment_intent: string
          p_student_id: string
          p_subscription_id: string
        }
        Returns: string
      }
      immutable_unaccent: { Args: { "": string }; Returns: string }
      increment_enrollment: {
        Args: { p_offering_id: string }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      is_admin_or_mod: { Args: never; Returns: boolean }
      is_moderator: { Args: never; Returns: boolean }
      lock_slot_instance: { Args: { p_slot_id: string }; Returns: boolean }
      materialize_availability_instances: {
        Args: { p_horizon_end: string }
        Returns: undefined
      }
      murajaah_due_student_ids: {
        Args: { p_active_since: string; p_today_start: string }
        Returns: {
          student_id: string
        }[]
      }
      open_overflow_halaqa: {
        Args: { p_source_offering_id: string }
        Returns: {
          halaqa_id: string
          was_created: boolean
        }[]
      }
      profiles_role_counts: {
        Args: never
        Returns: {
          n: number
          role: string
        }[]
      }
      reassign_teacher_atomic: {
        Args: {
          p_admin_id: string
          p_assignment_id: string
          p_new_teacher_id: string
        }
        Returns: {
          cancellation_count: number
          student_id: string
        }[]
      }
      recompute_course_review_aggregates: {
        Args: { p_course_id: string }
        Returns: undefined
      }
      reconcile_external_prepaid_refund: {
        Args: { p_payment_intent: string }
        Returns: undefined
      }
      record_prepaid_event: {
        Args: {
          p_event_type: string
          p_hours_delta: number
          p_package: string
          p_stripe_ref: string
        }
        Returns: undefined
      }
      record_student_progress: {
        Args: {
          p_ayah_from: number
          p_ayah_to: number
          p_booking_id: string
          p_errors: Json
          p_level: string
          p_pages_reviewed: number
          p_progress_type: string
          p_quality_rating: number
          p_surah_from: number
          p_surah_to: number
          p_teacher_notes: string
        }
        Returns: string
      }
      redact_pii: { Args: { payload: Json }; Returns: Json }
      refund_package_session: {
        Args: { p_package_id: string }
        Returns: boolean
      }
      release_prepaid_refund: {
        Args: { p_refund_request_id: string }
        Returns: undefined
      }
      reserve_prepaid_refund: {
        Args: { p_hours: number; p_lot: string; p_refund_request_id: string }
        Returns: number
      }
      restore_student_package: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      roster_recent_evaluations: {
        Args: { p_student_ids: string[]; p_teacher_id: string }
        Returns: {
          areas_for_improvement: string | null
          attendance_score: number | null
          created_at: string
          evaluation_date: string
          evaluation_type: Database["public"]["Enums"]["evaluation_type"]
          fluency_score: number | null
          hifz_score: number | null
          id: string
          next_goals: string | null
          overall_score: number | null
          strengths: string | null
          student_id: string
          tajweed_score: number | null
          teacher_comments: string | null
          teacher_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "session_evaluations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      roster_recent_progress: {
        Args: { p_student_ids: string[] }
        Returns: {
          ayah_from: number | null
          ayah_to: number | null
          booking_id: string
          created_at: string
          id: string
          level: Database["public"]["Enums"]["student_level"]
          pages_reviewed: number | null
          progress_type: string
          quality_rating: number | null
          recitation_standard: string | null
          student_id: string
          surah_from: number | null
          surah_to: number | null
          teacher_id: string
          teacher_notes: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "student_progress"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      run_monthly_payroll: { Args: { p_month: string }; Returns: number }
      search_public_teachers: {
        Args: {
          p_gender?: string
          p_language?: string
          p_limit?: number
          p_page?: number
          p_price_max?: number
          p_price_min?: number
          p_query?: string
          p_rating_weight?: number
          p_specialty?: string
        }
        Returns: {
          avatar_url: string
          bio: string
          bio_en: string
          full_name: string
          full_name_ar: string
          gender: string
          hourly_rate: number
          id: string
          languages: string[]
          rating_avg: number
          rating_count: number
          recitation_standards: string[]
          specialties: string[]
          total_count: number
          total_sessions: number
        }[]
      }
      search_teachers: {
        Args: { p_limit: number; p_needle: string; p_offset: number }
        Returns: {
          avatar_url: string
          cv_status: string
          email: string
          full_name: string
          hourly_rate: number
          is_accepting: boolean
          is_archived: boolean
          rating_avg: number
          specialties: string[]
          teacher_id: string
          total_count: number
          total_sessions: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      start_instant_session_booking:
        | {
            Args: {
              p_amount_usd: number
              p_duration_min: number
              p_rate_snapshot: number
              p_scheduled_at: string
              p_session_type: Database["public"]["Enums"]["session_type"]
              p_student_id: string
              p_teacher_id: string
            }
            Returns: string
          }
        | {
            Args: {
              p_amount_usd: number
              p_duration_min: number
              p_payment_id?: string
              p_rate_snapshot: number
              p_scheduled_at: string
              p_session_type: Database["public"]["Enums"]["session_type"]
              p_student_id: string
              p_teacher_id: string
            }
            Returns: string
          }
      start_session_from_webhook: {
        Args: {
          p_event_id: string
          p_payload_json: Json
          p_room_name: string
          p_session_id: string
          p_started_at: string
        }
        Returns: boolean
      }
      sweep_expired_prepaid_hours: { Args: never; Returns: number }
      teacher_at_risk_students: {
        Args: { p_limit?: number; p_teacher_id: string }
        Returns: {
          churn_risk_score: number
          full_name: string
          last_session_at: string
          package_remaining: number
          student_id: string
        }[]
      }
      teacher_distinct_students: {
        Args: { p_teacher_id: string }
        Returns: {
          student_id: string
        }[]
      }
      teacher_student_booking_stats: {
        Args: never
        Returns: {
          last_session: string
          student_id: string
          this_month: number
          total: number
        }[]
      }
      unaccent: { Args: { "": string }; Returns: string }
      user_is_session_participant: { Args: { s_id: string }; Returns: boolean }
    }
    Enums: {
      attendance_outcome:
        | "present"
        | "student_absent"
        | "teacher_absent"
        | "excused_carried"
      attendance_status:
        | "registered"
        | "attended"
        | "absent"
        | "late"
        | "left_early"
      billing_event_status: "received" | "processed" | "ignored" | "failed"
      billing_plan_type: "recurring_monthly" | "recurring_limited"
      booking_cancel_reason_code:
        | "teacher_unavailable"
        | "student_request"
        | "schedule_conflict"
        | "technical_issue"
        | "admin_override"
        | "package_exhausted"
        | "other"
      booking_status:
        | "pending"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "no_show"
      certificate_type:
        | "appreciation_juz"
        | "appreciation_level"
        | "course_completion"
      credit_action: "none" | "debited" | "restored"
      cv_status: "draft" | "pending_review" | "approved" | "rejected"
      evaluation_type: "weekly" | "biweekly" | "monthly" | "quarterly"
      excuse_status: "pending" | "accepted" | "rejected" | "ineligible"
      gender_type: "male" | "female"
      homework_status:
        | "assigned"
        | "student_ready"
        | "completed_excellent"
        | "completed_good"
        | "completed_needs_work"
        | "completed_not_done"
      homework_type:
        | "hifz"
        | "muraja"
        | "recitation"
        | "tajweed"
        | "writing"
        | "listening"
      msg_type: "text" | "audio" | "file"
      notif_type:
        | "booking"
        | "payment"
        | "message"
        | "reminder"
        | "system"
        | "homework"
        | "course"
      participant_role: "teacher" | "student"
      payment_status: "pending" | "succeeded" | "failed" | "refunded"
      earning_entry_kind:
        | "session"
        | "course"
        | "clawback"
        | "debt_recovery"
        | "debt_recovery_reversal"
      earning_entry_status:
        | "pending"
        | "processing"
        | "held"
        | "transferred"
        | "voided"
        | "debt_recovered"
        | "manual_due"
        | "manual_paid"
      payout_hold_source: "admin" | "dispute"
      payout_status: "pending" | "paid" | "failed"
      teacher_transfer_kind: "transfer" | "reversal"
      teacher_transfer_status: "pending" | "succeeded" | "failed"
      report_type:
        | "session_summary"
        | "evaluation"
        | "custom"
        | "missed_session"
        | "schedule_change"
      session_mode: "private" | "halaqa" | "lecture"
      session_type:
        | "hifz"
        | "muraja"
        | "tajweed"
        | "tilawa"
        | "qiraat"
        | "tafsir"
        | "combined"
        | "other"
      specialized_purpose:
        | "review"
        | "consolidate_surah"
        | "memorize_mutoon"
        | "test_juz_mutashabihat"
      student_level: "beginner" | "intermediate" | "advanced"
      subscription_status:
        | "incomplete"
        | "active"
        | "past_due"
        | "canceled"
        | "incomplete_expired"
        | "unpaid"
      user_role: "student" | "teacher" | "admin" | "guardian" | "moderator"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      attendance_outcome: [
        "present",
        "student_absent",
        "teacher_absent",
        "excused_carried",
      ],
      attendance_status: [
        "registered",
        "attended",
        "absent",
        "late",
        "left_early",
      ],
      billing_event_status: ["received", "processed", "ignored", "failed"],
      billing_plan_type: ["recurring_monthly", "recurring_limited"],
      booking_cancel_reason_code: [
        "teacher_unavailable",
        "student_request",
        "schedule_conflict",
        "technical_issue",
        "admin_override",
        "package_exhausted",
        "other",
      ],
      booking_status: [
        "pending",
        "confirmed",
        "completed",
        "cancelled",
        "no_show",
      ],
      certificate_type: [
        "appreciation_juz",
        "appreciation_level",
        "course_completion",
      ],
      credit_action: ["none", "debited", "restored"],
      cv_status: ["draft", "pending_review", "approved", "rejected"],
      evaluation_type: ["weekly", "biweekly", "monthly", "quarterly"],
      excuse_status: ["pending", "accepted", "rejected", "ineligible"],
      gender_type: ["male", "female"],
      homework_status: [
        "assigned",
        "student_ready",
        "completed_excellent",
        "completed_good",
        "completed_needs_work",
        "completed_not_done",
      ],
      homework_type: [
        "hifz",
        "muraja",
        "recitation",
        "tajweed",
        "writing",
        "listening",
      ],
      msg_type: ["text", "audio", "file"],
      notif_type: [
        "booking",
        "payment",
        "message",
        "reminder",
        "system",
        "homework",
        "course",
      ],
      participant_role: ["teacher", "student"],
      payment_status: ["pending", "succeeded", "failed", "refunded"],
      earning_entry_kind: [
        "session",
        "course",
        "clawback",
        "debt_recovery",
        "debt_recovery_reversal",
      ],
      earning_entry_status: [
        "pending",
        "processing",
        "held",
        "transferred",
        "voided",
        "debt_recovered",
        "manual_due",
        "manual_paid",
      ],
      payout_hold_source: ["admin", "dispute"],
      payout_status: ["pending", "paid", "failed"],
      teacher_transfer_kind: ["transfer", "reversal"],
      teacher_transfer_status: ["pending", "succeeded", "failed"],
      report_type: [
        "session_summary",
        "evaluation",
        "custom",
        "missed_session",
        "schedule_change",
      ],
      session_mode: ["private", "halaqa", "lecture"],
      session_type: [
        "hifz",
        "muraja",
        "tajweed",
        "tilawa",
        "qiraat",
        "tafsir",
        "combined",
        "other",
      ],
      specialized_purpose: [
        "review",
        "consolidate_surah",
        "memorize_mutoon",
        "test_juz_mutashabihat",
      ],
      student_level: ["beginner", "intermediate", "advanced"],
      subscription_status: [
        "incomplete",
        "active",
        "past_due",
        "canceled",
        "incomplete_expired",
        "unpaid",
      ],
      user_role: ["student", "teacher", "admin", "guardian", "moderator"],
    },
  },
} as const
