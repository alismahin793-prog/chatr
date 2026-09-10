/** Non-secret env-var metadata stored on cloud_projects. Values live in the secrets provider. */
export interface CloudEnvVarMetadata {
  name: string;
  configured: boolean;
  updatedAt: string | null;
}

/** AI-generated development plan stored on self_development_requests.plan. */
export interface SelfDevelopmentPlan {
  goal: string;
  currentArchitecture: string;
  affectedFiles: string[];
  affectedSystems: string[];
  requiredChanges: string;
  potentialRisks: string;
  databaseChanges: string;
  apiChanges: string;
  uiChanges: string;
  securityImpact: string;
  testingStrategy: string;
  deploymentImpact: string;
  rollbackStrategy: string;
}

/** AI review result stored on self_development_requests.review. */
export type SelfDevelopmentReviewResult = "approved" | "needs_changes" | "blocked";

export interface SelfDevelopmentReview {
  result: SelfDevelopmentReviewResult;
  summary: string;
  security: string;
  correctness: string;
  architecture: string;
  regressionRisk: string;
  performance: string;
  codeQuality: string;
  tests: string;
  databaseImpact: string;
  authImpact: string;
  deploymentImpact: string;
  reviewedAt: string;
}

export type SelfDevelopmentRequestStatus =
  | "draft"
  | "planning"
  | "awaiting_plan_approval"
  | "snapshotting"
  | "workspace_preparing"
  | "analyzing"
  | "modifying"
  | "testing"
  | "typechecking"
  | "linting"
  | "building"
  | "reviewing"
  | "awaiting_deploy_approval"
  | "deploying"
  | "verifying"
  | "completed"
  | "failed"
  | "rolled_back"
  | "cancelled"
  | "rejected";

export type SelfDevelopmentRiskLevel = "low" | "medium" | "high" | "critical";

export type SelfDevelopmentStepStatus = "pending" | "running" | "passed" | "failed" | "cancelled";

export type SelfDevelopmentChangeOperation = "create" | "edit" | "rename" | "delete";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          role: "user" | "super_admin";
          admin_verified_at: string | null;
          status: "active" | "approved" | "pending" | "rejected" | "disabled";
          is_test_user: boolean;
          expires_at: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          /** Only the service role writes these — tenants cannot update them. */
          status?: "active" | "approved" | "pending" | "rejected" | "disabled";
          is_test_user?: boolean;
          expires_at?: string | null;
        };
        Update: {
          display_name?: string | null;
          admin_verified_at?: string | null;
          /** Only the service role writes this — tenants cannot update it. */
          status?: "active" | "approved" | "pending" | "rejected" | "disabled";
          /** Only the service role writes this — tenants cannot update it. */
          is_test_user?: boolean;
          /** Only the service role writes this — tenants cannot update it. */
          expires_at?: string | null;
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
      app_permissions: {
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
      features: {
        Row: {
          id: string;
          key: string;
          name: string;
          description: string;
          enabled: boolean;
          available_to_users: boolean;
          version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          key: string;
          name: string;
          description?: string;
          enabled?: boolean;
          available_to_users?: boolean;
          version?: number;
        };
        Update: {
          name?: string;
          description?: string;
          enabled?: boolean;
          available_to_users?: boolean;
          version?: number;
        };
        Relationships: [];
      };
      improvement_proposals: {
        Row: {
          id: string;
          title: string;
          description: string;
          status: "proposed" | "approved" | "rejected" | "implemented";
          proposed_by: string | null;
          reviewed_by: string | null;
          review_comment: string | null;
          created_at: string;
          reviewed_at: string | null;
        };
        Insert: {
          title: string;
          description?: string;
          status?: "proposed" | "approved" | "rejected" | "implemented";
          proposed_by?: string | null;
          reviewed_by?: string | null;
          review_comment?: string | null;
          reviewed_at?: string | null;
        };
        Update: {
          status?: "proposed" | "approved" | "rejected" | "implemented";
          reviewed_by?: string | null;
          review_comment?: string | null;
          reviewed_at?: string | null;
        };
        Relationships: [];
      };
      ai_request_log: {
        Row: {
          id: string;
          user_id: string;
          conversation_id: string | null;
          provider: string;
          model: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          conversation_id?: string | null;
          provider: string;
          model: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      cloud_projects: {
        Row: {
          id: string;
          name: string;
          slug: string;
          description: string;
          status: "active" | "archived";
          repo_url: string | null;
          default_branch: string;
          base_env: string;
          last_build_status: "passed" | "failed" | "never";
          last_deployment_status:
            | "queued"
            | "building"
            | "ready"
            | "failed"
            | "cancelled"
            | "rolled_back"
            | "never";
          env_vars: CloudEnvVarMetadata[];
          created_at: string;
          updated_at: string;
          last_activity_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          description?: string;
          status?: "active" | "archived";
          repo_url?: string | null;
          default_branch?: string;
          base_env?: string;
          last_build_status?: "passed" | "failed" | "never";
          last_deployment_status?:
            | "queued"
            | "building"
            | "ready"
            | "failed"
            | "cancelled"
            | "rolled_back"
            | "never";
          env_vars?: CloudEnvVarMetadata[];
          updated_at?: string;
          last_activity_at?: string;
        };
        Update: {
          name?: string;
          description?: string;
          status?: "active" | "archived";
          repo_url?: string | null;
          default_branch?: string;
          base_env?: string;
          last_build_status?: "passed" | "failed" | "never";
          last_deployment_status?:
            | "queued"
            | "building"
            | "ready"
            | "failed"
            | "cancelled"
            | "rolled_back"
            | "never";
          env_vars?: CloudEnvVarMetadata[];
          last_activity_at?: string;
        };
        Relationships: [];
      };
      cloud_operations: {
        Row: {
          id: string;
          project_id: string;
          kind:
            | "command"
            | "install"
            | "lint"
            | "typecheck"
            | "test"
            | "build"
            | "git"
            | "snapshot"
            | "deployment"
            | "rollback"
            | "environment"
            | "file"
            | "process";
          status: "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out";
          program: string;
          args: string[];
          working_dir: string | null;
          exit_code: number | null;
          duration_ms: number | null;
          output_head: string;
          output_truncated: boolean;
          admin_id: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          kind:
            | "command"
            | "install"
            | "lint"
            | "typecheck"
            | "test"
            | "build"
            | "git"
            | "snapshot"
            | "deployment"
            | "rollback"
            | "environment"
            | "file"
            | "process";
          status?: "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out";
          program: string;
          args?: string[];
          working_dir?: string | null;
          exit_code?: number | null;
          duration_ms?: number | null;
          output_head?: string;
          output_truncated?: boolean;
          admin_id?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Update: {
          status?: "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out";
          exit_code?: number | null;
          duration_ms?: number | null;
          output_head?: string;
          output_truncated?: boolean;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      cloud_snapshots: {
        Row: {
          id: string;
          project_id: string;
          reason: string;
          ref: string;
          status: "created" | "restoring" | "restored" | "failed";
          created_by: string | null;
          created_at: string;
          restored_at: string | null;
        };
        Insert: {
          id?: string;
          project_id: string;
          reason: string;
          ref: string;
          status?: "created" | "restoring" | "restored" | "failed";
          created_by?: string | null;
          restored_at?: string | null;
        };
        Update: {
          status?: "created" | "restoring" | "restored" | "failed";
          restored_at?: string | null;
        };
        Relationships: [];
      };
      cloud_deployments: {
        Row: {
          id: string;
          project_id: string;
          kind: "preview" | "production";
          ref: string;
          branch: string | null;
          status: "queued" | "building" | "ready" | "failed" | "cancelled" | "rolled_back";
          url: string | null;
          request_id: string | null;
          build_logs_head: string;
          initiated_by: string | null;
          created_at: string;
          completed_at: string | null;
          rolled_back_at: string | null;
        };
        Insert: {
          id?: string;
          project_id: string;
          kind: "preview" | "production";
          ref: string;
          branch?: string | null;
          status?: "queued" | "building" | "ready" | "failed" | "cancelled" | "rolled_back";
          url?: string | null;
          request_id?: string | null;
          build_logs_head?: string;
          initiated_by?: string | null;
          completed_at?: string | null;
          rolled_back_at?: string | null;
        };
        Update: {
          status?: "queued" | "building" | "ready" | "failed" | "cancelled" | "rolled_back";
          url?: string | null;
          build_logs_head?: string;
          completed_at?: string | null;
          rolled_back_at?: string | null;
        };
        Relationships: [];
      };
      cloud_previews: {
        Row: {
          id: string;
          project_id: string;
          deployment_id: string | null;
          commit: string | null;
          status: "building" | "ready" | "expired" | "failed";
          url: string | null;
          expires_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          deployment_id?: string | null;
          commit?: string | null;
          status?: "building" | "ready" | "expired" | "failed";
          url?: string | null;
          expires_at?: string | null;
        };
        Update: {
          status?: "building" | "ready" | "expired" | "failed";
          url?: string | null;
          expires_at?: string | null;
        };
        Relationships: [];
      };
      self_development_requests: {
        Row: {
          id: string;
          project_id: string;
          requested_by: string | null;
          prompt: string;
          status: SelfDevelopmentRequestStatus;
          risk_level: SelfDevelopmentRiskLevel;
          plan: SelfDevelopmentPlan | null;
          review: SelfDevelopmentReview | null;
          branch: string | null;
          snapshot_id: string | null;
          deployment_id: string | null;
          approved_by: string | null;
          approved_at: string | null;
          plan_approved_by: string | null;
          plan_approved_at: string | null;
          error: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          requested_by?: string | null;
          prompt: string;
          status?: SelfDevelopmentRequestStatus;
          risk_level?: SelfDevelopmentRiskLevel;
          plan?: SelfDevelopmentPlan | null;
          review?: SelfDevelopmentReview | null;
          branch?: string | null;
          snapshot_id?: string | null;
          deployment_id?: string | null;
          approved_by?: string | null;
          approved_at?: string | null;
          plan_approved_by?: string | null;
          plan_approved_at?: string | null;
          error?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Update: {
          status?: SelfDevelopmentRequestStatus;
          risk_level?: SelfDevelopmentRiskLevel;
          plan?: SelfDevelopmentPlan | null;
          review?: SelfDevelopmentReview | null;
          branch?: string | null;
          snapshot_id?: string | null;
          deployment_id?: string | null;
          approved_by?: string | null;
          approved_at?: string | null;
          plan_approved_by?: string | null;
          plan_approved_at?: string | null;
          error?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      self_development_steps: {
        Row: {
          id: string;
          request_id: string;
          stage: string;
          status: SelfDevelopmentStepStatus;
          operation_id: string | null;
          exit_code: number | null;
          duration_ms: number | null;
          output_head: string;
          output_truncated: boolean;
          error: string | null;
          step_order: number;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          request_id: string;
          stage: string;
          status?: SelfDevelopmentStepStatus;
          operation_id?: string | null;
          exit_code?: number | null;
          duration_ms?: number | null;
          output_head?: string;
          output_truncated?: boolean;
          error?: string | null;
          step_order?: number;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Update: {
          status?: SelfDevelopmentStepStatus;
          operation_id?: string | null;
          exit_code?: number | null;
          duration_ms?: number | null;
          output_head?: string;
          output_truncated?: boolean;
          error?: string | null;
          step_order?: number;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      self_development_changes: {
        Row: {
          id: string;
          request_id: string;
          file: string;
          operation: SelfDevelopmentChangeOperation;
          path_from: string | null;
          path_to: string | null;
          diff: string;
          before_sha256: string | null;
          after_sha256: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          request_id: string;
          file: string;
          operation: SelfDevelopmentChangeOperation;
          path_from?: string | null;
          path_to?: string | null;
          diff?: string;
          before_sha256?: string | null;
          after_sha256?: string | null;
        };
        Update: {
          operation?: SelfDevelopmentChangeOperation;
          path_from?: string | null;
          path_to?: string | null;
          diff?: string;
          before_sha256?: string | null;
          after_sha256?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}