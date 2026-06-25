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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ai_prompts: {
        Row: {
          company_info: string
          created_at: string
          id: string
          name: string
          prompt: string
          tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          company_info?: string
          created_at?: string
          id?: string
          name: string
          prompt?: string
          tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          company_info?: string
          created_at?: string
          id?: string
          name?: string
          prompt?: string
          tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      auto_reply_log: {
        Row: {
          ai_response: string
          created_at: string
          error_message: string | null
          id: string
          inbox_message_id: string | null
          rule_id: string | null
          sent_at: string | null
          status: string
          subject: string
          to_email: string
          user_id: string
        }
        Insert: {
          ai_response?: string
          created_at?: string
          error_message?: string | null
          id?: string
          inbox_message_id?: string | null
          rule_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          to_email: string
          user_id: string
        }
        Update: {
          ai_response?: string
          created_at?: string
          error_message?: string | null
          id?: string
          inbox_message_id?: string | null
          rule_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          to_email?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_reply_log_inbox_message_id_fkey"
            columns: ["inbox_message_id"]
            isOneToOne: false
            referencedRelation: "inbox_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_reply_log_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "auto_reply_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_reply_rules: {
        Row: {
          account_ids: string[]
          account_tags: string[]
          company_info: string
          created_at: string
          delay_minutes: number
          id: string
          is_active: boolean
          name: string
          prompt: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_ids?: string[]
          account_tags?: string[]
          company_info?: string
          created_at?: string
          delay_minutes?: number
          id?: string
          is_active?: boolean
          name: string
          prompt?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_ids?: string[]
          account_tags?: string[]
          company_info?: string
          created_at?: string
          delay_minutes?: number
          id?: string
          is_active?: boolean
          name?: string
          prompt?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      blocklist: {
        Row: {
          created_at: string
          entry_type: string
          id: string
          user_id: string
          value: string
        }
        Insert: {
          created_at?: string
          entry_type?: string
          id?: string
          user_id: string
          value: string
        }
        Update: {
          created_at?: string
          entry_type?: string
          id?: string
          user_id?: string
          value?: string
        }
        Relationships: []
      }
      campaign_accounts: {
        Row: {
          account_id: string
          campaign_id: string
          id: string
        }
        Insert: {
          account_id: string
          campaign_id: string
          id?: string
        }
        Update: {
          account_id?: string
          campaign_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_accounts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_leads: {
        Row: {
          assigned_account_id: string | null
          campaign_id: string
          current_step: number
          id: string
          last_sent_at: string | null
          lead_id: string
          status: string
        }
        Insert: {
          assigned_account_id?: string | null
          campaign_id: string
          current_step?: number
          id?: string
          last_sent_at?: string | null
          lead_id: string
          status?: string
        }
        Update: {
          assigned_account_id?: string | null
          campaign_id?: string
          current_step?: number
          id?: string
          last_sent_at?: string | null
          lead_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_leads_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_steps: {
        Row: {
          body: string
          campaign_id: string
          created_at: string
          delay_days: number
          id: string
          step_order: number
          subject: string
          variants: Json | null
        }
        Insert: {
          body: string
          campaign_id: string
          created_at?: string
          delay_days?: number
          id?: string
          step_order?: number
          subject: string
          variants?: Json | null
        }
        Update: {
          body?: string
          campaign_id?: string
          created_at?: string
          delay_days?: number
          id?: string
          step_order?: number
          subject?: string
          variants?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_steps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          ab_test_enabled: boolean
          account_tags: string[]
          ai_filter_hostile: string
          ai_filter_unlikely: string
          break_thread_after: number | null
          created_at: string
          crm_enabled: boolean
          daily_limit: number | null
          domain_daily_limit: number
          domain_limit_enabled: boolean
          expert_rotation: boolean
          first_email_text_only: boolean
          id: string
          last_campaign_send_at: string | null
          name: string
          prioritize_new_leads: boolean
          provider_matching: boolean
          send_days: string[] | null
          send_end_hour: number | null
          send_start_hour: number | null
          signature_html: string
          slow_ramp_enabled: boolean
          slow_ramp_increment: number
          slow_ramp_max: number
          status: string
          stop_on_reply: boolean | null
          text_only_emails: boolean
          timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ab_test_enabled?: boolean
          account_tags?: string[]
          ai_filter_hostile?: string
          ai_filter_unlikely?: string
          break_thread_after?: number | null
          created_at?: string
          crm_enabled?: boolean
          daily_limit?: number | null
          domain_daily_limit?: number
          domain_limit_enabled?: boolean
          expert_rotation?: boolean
          first_email_text_only?: boolean
          id?: string
          last_campaign_send_at?: string | null
          name: string
          prioritize_new_leads?: boolean
          provider_matching?: boolean
          send_days?: string[] | null
          send_end_hour?: number | null
          send_start_hour?: number | null
          signature_html?: string
          slow_ramp_enabled?: boolean
          slow_ramp_increment?: number
          slow_ramp_max?: number
          status?: string
          stop_on_reply?: boolean | null
          text_only_emails?: boolean
          timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ab_test_enabled?: boolean
          account_tags?: string[]
          ai_filter_hostile?: string
          ai_filter_unlikely?: string
          break_thread_after?: number | null
          created_at?: string
          crm_enabled?: boolean
          daily_limit?: number | null
          domain_daily_limit?: number
          domain_limit_enabled?: boolean
          expert_rotation?: boolean
          first_email_text_only?: boolean
          id?: string
          last_campaign_send_at?: string | null
          name?: string
          prioritize_new_leads?: boolean
          provider_matching?: boolean
          send_days?: string[] | null
          send_end_hour?: number | null
          send_start_hour?: number | null
          signature_html?: string
          slow_ramp_enabled?: boolean
          slow_ramp_increment?: number
          slow_ramp_max?: number
          status?: string
          stop_on_reply?: boolean | null
          text_only_emails?: boolean
          timezone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      community_messages: {
        Row: {
          content: string | null
          created_at: string
          id: string
          media_url: string | null
          message_type: string
          moderation_status: string
          reply_count: number
          template_id: string | null
          template_snapshot: Json | null
          thread_id: string | null
          user_id: string
          user_name: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          media_url?: string | null
          message_type?: string
          moderation_status?: string
          reply_count?: number
          template_id?: string | null
          template_snapshot?: Json | null
          thread_id?: string | null
          user_id: string
          user_name?: string
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          media_url?: string | null
          message_type?: string
          moderation_status?: string
          reply_count?: number
          template_id?: string | null
          template_snapshot?: Json | null
          thread_id?: string | null
          user_id?: string
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_messages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "community_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      email_accounts: {
        Row: {
          created_at: string
          daily_limit: number
          email: string
          first_name: string | null
          id: string
          imap_host: string
          imap_password: string
          imap_port: number
          imap_username: string
          last_health_check: string | null
          last_name: string | null
          last_send_at: string | null
          send_end_hour: number
          send_start_hour: number
          sent_today: number
          smtp_host: string
          smtp_password: string
          smtp_port: number
          smtp_username: string
          status: string
          tags: string[]
          updated_at: string
          user_id: string
          warmup_day: number
          warmup_enabled: boolean
          warmup_score: number | null
          warmup_status_instantly: number | null
          warmup_synced_at: string | null
        }
        Insert: {
          created_at?: string
          daily_limit?: number
          email: string
          first_name?: string | null
          id?: string
          imap_host: string
          imap_password: string
          imap_port?: number
          imap_username: string
          last_health_check?: string | null
          last_name?: string | null
          last_send_at?: string | null
          send_end_hour?: number
          send_start_hour?: number
          sent_today?: number
          smtp_host: string
          smtp_password: string
          smtp_port?: number
          smtp_username: string
          status?: string
          tags?: string[]
          updated_at?: string
          user_id: string
          warmup_day?: number
          warmup_enabled?: boolean
          warmup_score?: number | null
          warmup_status_instantly?: number | null
          warmup_synced_at?: string | null
        }
        Update: {
          created_at?: string
          daily_limit?: number
          email?: string
          first_name?: string | null
          id?: string
          imap_host?: string
          imap_password?: string
          imap_port?: number
          imap_username?: string
          last_health_check?: string | null
          last_name?: string | null
          last_send_at?: string | null
          send_end_hour?: number
          send_start_hour?: number
          sent_today?: number
          smtp_host?: string
          smtp_password?: string
          smtp_port?: number
          smtp_username?: string
          status?: string
          tags?: string[]
          updated_at?: string
          user_id?: string
          warmup_day?: number
          warmup_enabled?: boolean
          warmup_score?: number | null
          warmup_status_instantly?: number | null
          warmup_synced_at?: string | null
        }
        Relationships: []
      }
      email_tags: {
        Row: {
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          name: string
          subject: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          name: string
          subject?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          name?: string
          subject?: string
          user_id?: string
        }
        Relationships: []
      }
      godtube_channels: {
        Row: {
          avatar_url: string | null
          banner_url: string | null
          channel_name: string
          created_at: string
          description: string
          id: string
          is_official: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          banner_url?: string | null
          channel_name: string
          created_at?: string
          description?: string
          id?: string
          is_official?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          banner_url?: string | null
          channel_name?: string
          created_at?: string
          description?: string
          id?: string
          is_official?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      godtube_videos: {
        Row: {
          channel_id: string
          created_at: string
          description: string
          id: string
          is_pinned: boolean
          thumbnail_url: string | null
          title: string
          user_id: string
          video_url: string
          views: number
        }
        Insert: {
          channel_id: string
          created_at?: string
          description?: string
          id?: string
          is_pinned?: boolean
          thumbnail_url?: string | null
          title: string
          user_id: string
          video_url: string
          views?: number
        }
        Update: {
          channel_id?: string
          created_at?: string
          description?: string
          id?: string
          is_pinned?: boolean
          thumbnail_url?: string | null
          title?: string
          user_id?: string
          video_url?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "godtube_videos_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "godtube_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_messages: {
        Row: {
          account_id: string
          auto_replied: boolean
          body_html: string | null
          body_text: string | null
          campaign_id: string | null
          created_at: string
          dedupe_hash: string | null
          from_email: string
          from_name: string | null
          id: string
          is_archived: boolean
          is_read: boolean
          labels: string[] | null
          lead_id: string | null
          message_id: string | null
          received_at: string
          subject: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          auto_replied?: boolean
          body_html?: string | null
          body_text?: string | null
          campaign_id?: string | null
          created_at?: string
          dedupe_hash?: string | null
          from_email: string
          from_name?: string | null
          id?: string
          is_archived?: boolean
          is_read?: boolean
          labels?: string[] | null
          lead_id?: string | null
          message_id?: string | null
          received_at?: string
          subject?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          auto_replied?: boolean
          body_html?: string | null
          body_text?: string | null
          campaign_id?: string | null
          created_at?: string
          dedupe_hash?: string | null
          from_email?: string
          from_name?: string | null
          id?: string
          is_archived?: boolean
          is_read?: boolean
          labels?: string[] | null
          lead_id?: string | null
          message_id?: string | null
          received_at?: string
          subject?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_messages_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_messages_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_lists: {
        Row: {
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          created_at: string
          custom_fields: Json
          email: string
          id: string
          is_campaign_only: boolean
          list_id: string | null
          status: string
          user_id: string
          verification_status: string | null
        }
        Insert: {
          created_at?: string
          custom_fields?: Json
          email: string
          id?: string
          is_campaign_only?: boolean
          list_id?: string | null
          status?: string
          user_id: string
          verification_status?: string | null
        }
        Update: {
          created_at?: string
          custom_fields?: Json
          email?: string
          id?: string
          is_campaign_only?: boolean
          list_id?: string | null
          status?: string
          user_id?: string
          verification_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reminders: {
        Row: {
          created_at: string
          id: string
          is_done: boolean
          message_id: string
          note: string | null
          remind_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_done?: boolean
          message_id: string
          note?: string | null
          remind_at: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_done?: boolean
          message_id?: string
          note?: string | null
          remind_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reminders_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "inbox_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      personalization_jobs: {
        Row: {
          campaign_id: string
          column_name: string
          completed: number
          created_at: string
          errors: number
          id: string
          lead_ids: string[]
          prompt: string
          selected_fields: string[]
          status: string
          total: number
          updated_at: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          column_name: string
          completed?: number
          created_at?: string
          errors?: number
          id?: string
          lead_ids?: string[]
          prompt: string
          selected_fields?: string[]
          status?: string
          total?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          column_name?: string
          completed?: number
          created_at?: string
          errors?: number
          id?: string
          lead_ids?: string[]
          prompt?: string
          selected_fields?: string[]
          status?: string
          total?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personalization_jobs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          allowed_routes: string[] | null
          avatar_url: string | null
          birthday: string | null
          coins: number
          company_name: string | null
          contact_email: string | null
          created_at: string
          full_name: string | null
          id: string
          max_email_accounts: number | null
          notify_interested: boolean
          trial_started_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          allowed_routes?: string[] | null
          avatar_url?: string | null
          birthday?: string | null
          coins?: number
          company_name?: string | null
          contact_email?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          max_email_accounts?: number | null
          notify_interested?: boolean
          trial_started_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          allowed_routes?: string[] | null
          avatar_url?: string | null
          birthday?: string | null
          coins?: number
          company_name?: string | null
          contact_email?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          max_email_accounts?: number | null
          notify_interested?: boolean
          trial_started_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      sent_emails: {
        Row: {
          account_id: string | null
          body: string
          bounced_at: string | null
          campaign_id: string | null
          campaign_step_id: string | null
          created_at: string
          error_message: string | null
          id: string
          lead_id: string | null
          opened_at: string | null
          replied_at: string | null
          scheduled_at: string | null
          sent_at: string | null
          smtp_message_id: string | null
          status: string
          subject: string
          to_email: string
          transport: string | null
          user_id: string
          variant_index: number | null
        }
        Insert: {
          account_id?: string | null
          body: string
          bounced_at?: string | null
          campaign_id?: string | null
          campaign_step_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          lead_id?: string | null
          opened_at?: string | null
          replied_at?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          smtp_message_id?: string | null
          status?: string
          subject: string
          to_email: string
          transport?: string | null
          user_id: string
          variant_index?: number | null
        }
        Update: {
          account_id?: string | null
          body?: string
          bounced_at?: string | null
          campaign_id?: string | null
          campaign_step_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          lead_id?: string | null
          opened_at?: string | null
          replied_at?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          smtp_message_id?: string | null
          status?: string
          subject?: string
          to_email?: string
          transport?: string | null
          user_id?: string
          variant_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sent_emails_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sent_emails_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sent_emails_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sent_emails_campaign_step_id_fkey"
            columns: ["campaign_step_id"]
            isOneToOne: false
            referencedRelation: "campaign_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sent_emails_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      verification_jobs: {
        Row: {
          campaign_id: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          invalid: number
          last_heartbeat_at: string | null
          list_id: string | null
          notification_sent_at: string | null
          notify_email: string | null
          processed: number
          required_coins: number
          risky: number
          scope: string
          started_at: string | null
          status: string
          total: number
          updated_at: string
          user_id: string
          valid: number
        }
        Insert: {
          campaign_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          invalid?: number
          last_heartbeat_at?: string | null
          list_id?: string | null
          notification_sent_at?: string | null
          notify_email?: string | null
          processed?: number
          required_coins?: number
          risky?: number
          scope?: string
          started_at?: string | null
          status?: string
          total?: number
          updated_at?: string
          user_id: string
          valid?: number
        }
        Update: {
          campaign_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          invalid?: number
          last_heartbeat_at?: string | null
          list_id?: string | null
          notification_sent_at?: string | null
          notify_email?: string | null
          processed?: number
          required_coins?: number
          risky?: number
          scope?: string
          started_at?: string | null
          status?: string
          total?: number
          updated_at?: string
          user_id?: string
          valid?: number
        }
        Relationships: [
          {
            foreignKeyName: "verification_jobs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_jobs_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_executions: {
        Row: {
          completed_at: string | null
          execution_log: Json | null
          id: string
          started_at: string
          status: string
          trigger_data: Json | null
          user_id: string
          workflow_id: string
        }
        Insert: {
          completed_at?: string | null
          execution_log?: Json | null
          id?: string
          started_at?: string
          status?: string
          trigger_data?: Json | null
          user_id: string
          workflow_id: string
        }
        Update: {
          completed_at?: string | null
          execution_log?: Json | null
          id?: string
          started_at?: string
          status?: string
          trigger_data?: Json | null
          user_id?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_executions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          created_at: string
          description: string
          edges: Json
          id: string
          is_active: boolean
          name: string
          nodes: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string
          edges?: Json
          id?: string
          is_active?: boolean
          name: string
          nodes?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          edges?: Json
          id?: string
          is_active?: boolean
          name?: string
          nodes?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      email_accounts_safe: {
        Row: {
          created_at: string | null
          daily_limit: number | null
          email: string | null
          first_name: string | null
          id: string | null
          imap_host: string | null
          imap_password: string | null
          imap_port: number | null
          imap_username: string | null
          last_health_check: string | null
          last_name: string | null
          send_end_hour: number | null
          send_start_hour: number | null
          sent_today: number | null
          smtp_host: string | null
          smtp_password: string | null
          smtp_port: number | null
          smtp_username: string | null
          status: string | null
          tags: string[] | null
          updated_at: string | null
          user_id: string | null
          warmup_day: number | null
          warmup_enabled: boolean | null
        }
        Insert: {
          created_at?: string | null
          daily_limit?: number | null
          email?: string | null
          first_name?: string | null
          id?: string | null
          imap_host?: string | null
          imap_password?: never
          imap_port?: number | null
          imap_username?: string | null
          last_health_check?: string | null
          last_name?: string | null
          send_end_hour?: number | null
          send_start_hour?: number | null
          sent_today?: number | null
          smtp_host?: string | null
          smtp_password?: never
          smtp_port?: number | null
          smtp_username?: string | null
          status?: string | null
          tags?: string[] | null
          updated_at?: string | null
          user_id?: string | null
          warmup_day?: number | null
          warmup_enabled?: boolean | null
        }
        Update: {
          created_at?: string | null
          daily_limit?: number | null
          email?: string | null
          first_name?: string | null
          id?: string | null
          imap_host?: string | null
          imap_password?: never
          imap_port?: number | null
          imap_username?: string | null
          last_health_check?: string | null
          last_name?: string | null
          send_end_hour?: number | null
          send_start_hour?: number | null
          sent_today?: number | null
          smtp_host?: string | null
          smtp_password?: never
          smtp_port?: number | null
          smtp_username?: string | null
          status?: string | null
          tags?: string[] | null
          updated_at?: string | null
          user_id?: string | null
          warmup_day?: number | null
          warmup_enabled?: boolean | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_account_counts: {
        Args: never
        Returns: {
          count: number
          user_id: string
        }[]
      }
      admin_lead_counts: {
        Args: never
        Returns: {
          count: number
          user_id: string
        }[]
      }
      bulk_delete_leads: { Args: { lead_ids: string[] }; Returns: undefined }
      claim_next_verification_job: {
        Args: never
        Returns: {
          campaign_id: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          invalid: number
          last_heartbeat_at: string | null
          list_id: string | null
          notification_sent_at: string | null
          notify_email: string | null
          processed: number
          required_coins: number
          risky: number
          scope: string
          started_at: string | null
          status: string
          total: number
          updated_at: string
          user_id: string
          valid: number
        }
        SetofOptions: {
          from: "*"
          to: "verification_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      compute_inbox_message_dedupe_hash: {
        Args: {
          _account_id: string
          _body_text: string
          _from_email: string
          _message_id: string
          _received_at: string
          _subject: string
        }
        Returns: string
      }
      get_inbox_nonwarmup: {
        Args: { _limit?: number; _user_id: string }
        Returns: {
          account_id: string
          auto_replied: boolean
          body_html: string | null
          body_text: string | null
          campaign_id: string | null
          created_at: string
          dedupe_hash: string | null
          from_email: string
          from_name: string | null
          id: string
          is_archived: boolean
          is_read: boolean
          labels: string[] | null
          lead_id: string | null
          message_id: string | null
          received_at: string
          subject: string | null
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "inbox_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_video_views: { Args: { video_id: string }; Returns: undefined }
      touch_verification_job: { Args: { _job_id: string }; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "client"
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
  public: {
    Enums: {
      app_role: ["admin", "client"],
    },
  },
} as const
