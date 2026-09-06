export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          role: "user" | "admin";
          admin_verified_at: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
        };
        Update: {
          /** Only the service role writes this — tenants cannot update it. */
          admin_verified_at?: string | null;
        };
        Relationships: [];
      };
      admin_permissions: {
        Row: {
          id: string;
          user_id: string;
          permission: string;
          granted_at: string;
          granted_by: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          permission: string;
          granted_by?: string | null;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: string;
          actor_id: string | null;
          action: string;
          resource_type: string | null;
          resource_id: string | null;
          success: boolean;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          actor_id?: string | null;
          action: string;
          resource_type?: string | null;
          resource_id?: string | null;
          success?: boolean;
          metadata?: Record<string, unknown>;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          provider: string | null;
          model: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string;
          provider?: string | null;
          model?: string | null;
        };
        Update: {
          title?: string;
          provider?: string | null;
          model?: string | null;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          role: "user" | "assistant";
          content: string;
          created_at: string;
        };
        Insert: {
          conversation_id: string;
          role: "user" | "assistant";
          content: string;
        };
        Update: {
          content?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}