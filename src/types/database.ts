// Tipos de la base de datos escritos a mano (no se usa la CLI de Supabase).
// Mantener sincronizado con supabase/migrations/*. Sigue el formato de `supabase gen types`.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type UserRole = 'admin' | 'member'
export type Sex = 'male' | 'female' | 'other'
export type TrainingLevel = 'beginner' | 'intermediate' | 'advanced'
export type MuscleView = 'front' | 'back' | 'both'
export type MuscleGroup = 'upper' | 'core' | 'lower'
export type ExerciseCategory = 'strength' | 'functional' | 'cardio' | 'mobility' | 'sport'
export type TrackingType =
  'weight_reps' | 'reps' | 'time' | 'distance_time' | 'calories' | 'duration_only'
export type MuscleRole = 'primary' | 'secondary'
export type SessionType =
  | 'strength'
  | 'functional'
  | 'running'
  | 'swimming'
  | 'cycling'
  | 'spinning'
  | 'yoga'
  // 0031: padel_fronton se separa en fronton, padel y tennis; clases de gimnasio.
  | 'fronton'
  | 'padel'
  | 'tennis'
  | 'functional_class'
  | 'gap'
  | 'oxfit'
  | 'surf'
  | 'other'
  // Actividad personalizada del usuario (workout_sessions.activity_type_id).
  | 'custom'
export type SessionLocation = 'gym' | 'outdoor' | 'pool' | 'home' | 'other'
export type BlockType =
  | 'straight'
  | 'superset'
  | 'circuit'
  | 'emom'
  | 'amrap'
  | 'tabata'
  | 'for_time'
  | 'intervals'
  | 'free'
export type PrType =
  'est_1rm' | 'max_weight' | 'max_reps_at_weight' | 'best_time' | 'longest_distance' | 'best_pace'
export type PhotoPose = 'front' | 'side' | 'back'
export type PartnerLinkStatus = 'pending' | 'accepted' | 'revoked'
export type PairInviteStatus = 'pending' | 'accepted' | 'declined' | 'cancelled'
export type ReactionKind = 'week' | 'session'
export type ReactionEmoji = 'clap' | 'fire' | 'muscle'
export type EquivalenceKind = 'weight' | 'distance_route' | 'time'
export type DestinationType = 'city' | 'island' | 'landmark'
export type PlanFamily = 'running' | 'swimming' | 'strength' | 'hyrox' | 'deka' | 'hybrid'
export type UserPlanStatus = 'active' | 'completed' | 'archived'
export type PlanSource = 'template' | 'ai'
export type PlannedStatus = 'planned' | 'done' | 'skipped' | 'moved'
export type SessionIntensity = 'easy' | 'moderate' | 'hard'
export type AiInteractionKind =
  'plan_generation' | 'daily_adjust' | 'weekly_review' | 'chat' | 'exercise_swap'
export type AiInteractionStatus = 'pending' | 'ok' | 'invalid' | 'error'
export type AiChatRole = 'user' | 'assistant'
export type AiChangeResponse = 'accepted' | 'discarded'
export type InviteCodeState = 'active' | 'used' | 'expired' | 'revoked'

export type Database = {
  public: {
    Tables: {
      // 0001_profiles.sql
      profiles: {
        Row: {
          id: string
          display_name: string | null
          role: UserRole
          active: boolean
          sex: Sex | null
          birth_year: number | null
          height_cm: number | null
          home_city: string | null
          home_lat: number | null
          home_lng: number | null
          show_equivalence_popups: boolean
          // 0030_invite_links.sql: contraseña temporal del admin; obliga a cambiarla al entrar.
          must_change_password: boolean
          created_at: string
        }
        Insert: {
          id: string
          display_name?: string | null
          role?: UserRole
          active?: boolean
          sex?: Sex | null
          birth_year?: number | null
          height_cm?: number | null
          home_city?: string | null
          home_lat?: number | null
          home_lng?: number | null
          show_equivalence_popups?: boolean
          must_change_password?: boolean
          created_at?: string
        }
        // role y active solo se pueden cambiar con service role (ver GRANTs de la migración).
        Update: {
          display_name?: string | null
          role?: UserRole
          active?: boolean
          sex?: Sex | null
          birth_year?: number | null
          height_cm?: number | null
          home_city?: string | null
          home_lat?: number | null
          home_lng?: number | null
          show_equivalence_popups?: boolean
          must_change_password?: boolean
        }
        Relationships: []
      }
      // 0002_training_profiles.sql
      training_profiles: {
        Row: {
          user_id: string
          goals: Json
          level: TrainingLevel | null
          availability: Json
          equipment: string[]
          limitations: string | null
          fixed_activities: Json
          benchmarks: Json
          updated_at: string
        }
        Insert: {
          user_id: string
          goals?: Json
          level?: TrainingLevel | null
          availability?: Json
          equipment?: string[]
          limitations?: string | null
          fixed_activities?: Json
          benchmarks?: Json
          updated_at?: string
        }
        Update: {
          goals?: Json
          level?: TrainingLevel | null
          availability?: Json
          equipment?: string[]
          limitations?: string | null
          fixed_activities?: Json
          benchmarks?: Json
          updated_at?: string
        }
        Relationships: []
      }
      // 0003_catalog.sql
      muscles: {
        Row: { id: string; name: string; view: MuscleView; group: MuscleGroup }
        Insert: { id: string; name: string; view: MuscleView; group: MuscleGroup }
        Update: { name?: string; view?: MuscleView; group?: MuscleGroup }
        Relationships: []
      }
      exercises: {
        Row: {
          id: string
          name: string
          aliases: string[]
          category: ExerciseCategory
          tracking_type: TrackingType
          equipment: string[]
          is_unilateral: boolean
          is_compound: boolean
          default_rest_s: number
          technique_notes: string | null
          technique_steps: string[]
          technique_mistakes: string[]
          owner_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          aliases?: string[]
          category: ExerciseCategory
          tracking_type: TrackingType
          equipment?: string[]
          is_unilateral?: boolean
          is_compound?: boolean
          default_rest_s?: number
          technique_notes?: string | null
          technique_steps?: string[]
          technique_mistakes?: string[]
          owner_id?: string | null
          created_at?: string
        }
        Update: {
          name?: string
          aliases?: string[]
          category?: ExerciseCategory
          tracking_type?: TrackingType
          equipment?: string[]
          is_unilateral?: boolean
          is_compound?: boolean
          default_rest_s?: number
          technique_notes?: string | null
          technique_steps?: string[]
          technique_mistakes?: string[]
        }
        Relationships: []
      }
      exercise_muscles: {
        Row: { exercise_id: string; muscle_id: string; role: MuscleRole }
        Insert: { exercise_id: string; muscle_id: string; role: MuscleRole }
        Update: { role?: MuscleRole }
        Relationships: [
          {
            foreignKeyName: 'exercise_muscles_exercise_id_fkey'
            columns: ['exercise_id']
            isOneToOne: false
            referencedRelation: 'exercises'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'exercise_muscles_muscle_id_fkey'
            columns: ['muscle_id']
            isOneToOne: false
            referencedRelation: 'muscles'
            referencedColumns: ['id']
          },
        ]
      }
      // 0004_workouts.sql
      workout_sessions: {
        Row: {
          id: string
          user_id: string
          planned_session_id: string | null
          session_type: SessionType
          // 0031_activity_types.sql: solo con session_type = 'custom'.
          activity_type_id: string | null
          title: string | null
          started_at: string
          ended_at: string | null
          duration_min: number | null
          rpe: number | null
          distance_m: number | null
          avg_hr: number | null
          max_hr: number | null
          calories: number | null
          location: SessionLocation | null
          notes: string | null
          pair_group_id: string | null
          client_rev: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          planned_session_id?: string | null
          session_type?: SessionType
          activity_type_id?: string | null
          title?: string | null
          started_at?: string
          ended_at?: string | null
          duration_min?: number | null
          rpe?: number | null
          distance_m?: number | null
          avg_hr?: number | null
          max_hr?: number | null
          calories?: number | null
          location?: SessionLocation | null
          notes?: string | null
          pair_group_id?: string | null
          client_rev?: number
        }
        Update: {
          planned_session_id?: string | null
          session_type?: SessionType
          activity_type_id?: string | null
          title?: string | null
          started_at?: string
          ended_at?: string | null
          duration_min?: number | null
          rpe?: number | null
          distance_m?: number | null
          avg_hr?: number | null
          max_hr?: number | null
          calories?: number | null
          location?: SessionLocation | null
          notes?: string | null
          pair_group_id?: string | null
          client_rev?: number
        }
        Relationships: []
      }
      session_blocks: {
        Row: {
          id: string
          session_id: string
          user_id: string
          order: number
          block_type: BlockType
          config: Json
          result: Json | null
        }
        Insert: {
          id?: string
          session_id: string
          user_id?: string
          order?: number
          block_type?: BlockType
          config?: Json
          result?: Json | null
        }
        Update: {
          order?: number
          block_type?: BlockType
          config?: Json
          result?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: 'session_blocks_session_id_fkey'
            columns: ['session_id']
            isOneToOne: false
            referencedRelation: 'workout_sessions'
            referencedColumns: ['id']
          },
        ]
      }
      exercise_sets: {
        Row: {
          id: string
          session_id: string
          block_id: string
          user_id: string
          exercise_id: string
          set_index: number
          is_warmup: boolean
          weight_kg: number | null
          reps: number | null
          rir: number | null
          duration_s: number | null
          distance_m: number | null
          calories: number | null
          completed: boolean
          completed_at: string | null
        }
        Insert: {
          id?: string
          session_id: string
          block_id: string
          user_id?: string
          exercise_id: string
          set_index?: number
          is_warmup?: boolean
          weight_kg?: number | null
          reps?: number | null
          rir?: number | null
          duration_s?: number | null
          distance_m?: number | null
          calories?: number | null
          completed?: boolean
          completed_at?: string | null
        }
        Update: {
          block_id?: string
          exercise_id?: string
          set_index?: number
          is_warmup?: boolean
          weight_kg?: number | null
          reps?: number | null
          rir?: number | null
          duration_s?: number | null
          distance_m?: number | null
          calories?: number | null
          completed?: boolean
          completed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'exercise_sets_session_id_fkey'
            columns: ['session_id']
            isOneToOne: false
            referencedRelation: 'workout_sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'exercise_sets_block_id_fkey'
            columns: ['block_id']
            isOneToOne: false
            referencedRelation: 'session_blocks'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'exercise_sets_exercise_id_fkey'
            columns: ['exercise_id']
            isOneToOne: false
            referencedRelation: 'exercises'
            referencedColumns: ['id']
          },
        ]
      }
      // 0008_personal_records.sql (solo lectura: los calcula un trigger)
      personal_records: {
        Row: {
          id: string
          user_id: string
          exercise_id: string
          pr_type: PrType
          value: number
          unit: string
          weight_kg: number | null
          previous_value: number | null
          set_id: string | null
          session_id: string
          achieved_at: string
        }
        Insert: {
          id?: string
          user_id: string
          exercise_id: string
          pr_type: PrType
          value: number
          unit: string
          weight_kg?: number | null
          previous_value?: number | null
          set_id?: string | null
          session_id: string
          achieved_at: string
        }
        Update: { [_ in never]: never }
        Relationships: [
          {
            foreignKeyName: 'personal_records_exercise_id_fkey'
            columns: ['exercise_id']
            isOneToOne: false
            referencedRelation: 'exercises'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'personal_records_session_id_fkey'
            columns: ['session_id']
            isOneToOne: false
            referencedRelation: 'workout_sessions'
            referencedColumns: ['id']
          },
        ]
      }
      // 0009_body_metrics_photos.sql
      body_metrics: {
        Row: {
          id: string
          user_id: string
          date: string
          weight_kg: number | null
          body_fat_pct: number | null
          waist_cm: number | null
          hip_cm: number | null
          chest_cm: number | null
          arm_cm: number | null
          thigh_cm: number | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          date: string
          weight_kg?: number | null
          body_fat_pct?: number | null
          waist_cm?: number | null
          hip_cm?: number | null
          chest_cm?: number | null
          arm_cm?: number | null
          thigh_cm?: number | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          date?: string
          weight_kg?: number | null
          body_fat_pct?: number | null
          waist_cm?: number | null
          hip_cm?: number | null
          chest_cm?: number | null
          arm_cm?: number | null
          thigh_cm?: number | null
          notes?: string | null
        }
        Relationships: []
      }
      progress_photos: {
        Row: {
          id: string
          user_id: string
          date: string
          pose: PhotoPose
          storage_path: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          date: string
          pose: PhotoPose
          storage_path: string
          created_at?: string
        }
        Update: { [_ in never]: never }
        Relationships: []
      }
      // 0011_commitments.sql (crear/cambiar con set_commitment, quitar con end_commitment)
      commitments: {
        Row: {
          id: string
          user_id: string
          valid_from: string
          valid_to: string | null
          sessions_per_week: number
          minutes_per_week: number | null
          by_type: Json | null
          counts_free_activities: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          valid_from: string
          valid_to?: string | null
          sessions_per_week: number
          minutes_per_week?: number | null
          by_type?: Json | null
          counts_free_activities?: boolean
          created_at?: string
        }
        Update: {
          valid_from?: string
          valid_to?: string | null
          sessions_per_week?: number
          minutes_per_week?: number | null
          by_type?: Json | null
          counts_free_activities?: boolean
        }
        Relationships: []
      }
      // 0012_partner_links.sql (estado solo por RPC; el usuario edita los permisos de su fila)
      partner_links: {
        Row: {
          id: string
          user_id: string
          partner_id: string
          status: PartnerLinkStatus
          can_view_adherence: boolean
          can_view_sessions: boolean
          // 0027: mapa muscular y carga; logros. Las fotos nunca se comparten.
          can_view_muscles: boolean
          can_view_achievements: boolean
          can_view_metrics: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          partner_id: string
          status?: PartnerLinkStatus
          can_view_adherence?: boolean
          can_view_sessions?: boolean
          can_view_muscles?: boolean
          can_view_achievements?: boolean
          can_view_metrics?: boolean
        }
        Update: {
          can_view_adherence?: boolean
          can_view_sessions?: boolean
          can_view_muscles?: boolean
          can_view_achievements?: boolean
          can_view_metrics?: boolean
        }
        Relationships: []
      }
      // 0031_activity_types.sql: globales (owner_id null, id = session_type, semilla 0032) y
      // personalizadas del usuario (id 'a_…').
      activity_types: {
        Row: {
          id: string
          owner_id: string | null
          name: string
          emoji: string
          exercise_id: string
          location: SessionLocation
          muscles: string[]
          sets_per_30min: number
          quick: boolean
          fixed: boolean
          free_activity: boolean
          leg_loading: boolean
          hard_legs: boolean
          sort_order: number
          archived: boolean
          created_at: string
        }
        Insert: {
          id?: string
          owner_id?: string | null
          name: string
          emoji?: string
          muscles?: string[]
        }
        Update: {
          name?: string
          emoji?: string
          muscles?: string[]
          archived?: boolean
        }
        Relationships: []
      }
      // 0013_achievements.sql (global, solo lectura)
      equivalence_objects: {
        Row: {
          id: string
          kind: EquivalenceKind
          label: string
          label_plural: string
          article: string
          emoji: string
          value: number
          phrase_template: string
          min_value: number
        }
        Insert: {
          id: string
          kind: EquivalenceKind
          label: string
          label_plural: string
          article?: string
          emoji: string
          value: number
          phrase_template: string
          min_value?: number
        }
        Update: {
          kind?: EquivalenceKind
          label?: string
          label_plural?: string
          article?: string
          emoji?: string
          value?: number
          phrase_template?: string
          min_value?: number
        }
        Relationships: []
      }
      // 0013_achievements.sql (global, solo lectura)
      destinations: {
        Row: {
          id: string
          name: string
          lat: number
          lng: number
          type: DestinationType
          water_route: boolean
        }
        Insert: {
          id: string
          name: string
          lat: number
          lng: number
          type: DestinationType
          water_route?: boolean
        }
        Update: {
          name?: string
          lat?: number
          lng?: number
          type?: DestinationType
          water_route?: boolean
        }
        Relationships: []
      }
      // 0013_achievements.sql
      milestones_shown: {
        Row: {
          user_id: string
          milestone_key: string
          shown_at: string
        }
        Insert: {
          user_id?: string
          milestone_key: string
          shown_at?: string
        }
        Update: {
          milestone_key?: string
          shown_at?: string
        }
        Relationships: []
      }
      // 0017_plans.sql (plantillas globales de solo lectura)
      plan_templates: {
        Row: {
          id: string
          family: PlanFamily
          name: string
          level: TrainingLevel
          weeks: number
          days_per_week: number
          description: string
          structure: Json
        }
        Insert: {
          id: string
          family: PlanFamily
          name: string
          level: TrainingLevel
          weeks?: number
          days_per_week: number
          description?: string
          structure: Json
        }
        Update: { [_ in never]: never }
        Relationships: []
      }
      // 0017_plans.sql (se crean con create_user_plan; editables: status, name, notes)
      user_plans: {
        Row: {
          id: string
          user_id: string
          template_id: string | null
          name: string
          start_date: string
          status: UserPlanStatus
          source: PlanSource
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          template_id?: string | null
          name: string
          start_date: string
          status?: UserPlanStatus
          source?: PlanSource
          notes?: string | null
          created_at?: string
        }
        Update: {
          status?: UserPlanStatus
          name?: string
          notes?: string | null
        }
        Relationships: []
      }
      // 0017_plans.sql (editables: date, original_date, status; enlace por set_planned_session_done)
      planned_sessions: {
        Row: {
          id: string
          user_plan_id: string
          user_id: string
          date: string
          original_date: string | null
          week: number
          session_type: SessionType
          title: string
          intensity: SessionIntensity
          duration_min: number | null
          notes: string | null
          blocks: Json
          status: PlannedStatus
          workout_session_id: string | null
          created_at: string
          // 0023_phase5b.sql
          heavy_legs: boolean
          // 0024_ai_coach.sql (prescripción original antes del ajuste del día)
          adjusted_from: Json | null
        }
        Insert: {
          id?: string
          user_plan_id: string
          user_id?: string
          date: string
          original_date?: string | null
          week?: number
          session_type: SessionType
          title: string
          intensity?: SessionIntensity
          duration_min?: number | null
          notes?: string | null
          blocks?: Json
          status?: PlannedStatus
          workout_session_id?: string | null
          created_at?: string
          heavy_legs?: boolean
          adjusted_from?: Json | null
        }
        Update: {
          date?: string
          original_date?: string | null
          status?: PlannedStatus
        }
        Relationships: []
      }
      // 0023_phase5b.sql
      daily_checkins: {
        Row: {
          user_id: string
          date: string
          sleep: number | null
          energy: number | null
          soreness: number | null
          stress: number | null
          notes: string | null
          updated_at: string
        }
        Insert: {
          user_id?: string
          date: string
          sleep?: number | null
          energy?: number | null
          soreness?: number | null
          stress?: number | null
          notes?: string | null
          updated_at?: string
        }
        Update: {
          sleep?: number | null
          energy?: number | null
          soreness?: number | null
          stress?: number | null
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      // 0024_ai_coach.sql (alta y cierre por RPC; editable: accepted)
      ai_interactions: {
        Row: {
          id: string
          user_id: string
          kind: AiInteractionKind
          status: AiInteractionStatus
          provider: string | null
          model: string | null
          input_summary: Json | null
          output: Json | null
          error: string | null
          accepted: boolean | null
          tokens_in: number | null
          tokens_out: number | null
          created_at: string
          finished_at: string | null
          // 0025: semana de la revisión semanal y respuesta a cada cambio propuesto.
          period: string | null
          responses: Json
          // 0033: resultado de las acciones del chat («plan», «adjust»); solo por RPC.
          action_results: Json
        }
        Insert: {
          id?: string
          user_id?: string
          kind: AiInteractionKind
          status?: AiInteractionStatus
          provider?: string | null
          model?: string | null
          input_summary?: Json | null
          output?: Json | null
          error?: string | null
          accepted?: boolean | null
          tokens_in?: number | null
          tokens_out?: number | null
          created_at?: string
          finished_at?: string | null
          period?: string | null
          responses?: Json
          action_results?: Json
        }
        Update: {
          accepted?: boolean | null
        }
        Relationships: []
      }
      // 0025_ai_coach_review_chat.sql
      // 0027_partner_sharing.sql (escritura solo por RPC)
      pair_invites: {
        Row: {
          id: string
          pair_group_id: string
          from_user: string
          to_user: string
          payload: Json
          status: PairInviteStatus
          created_at: string
          updated_at: string
        }
        Insert: { [_ in never]: never }
        Update: { [_ in never]: never }
        Relationships: []
      }
      reactions: {
        Row: {
          id: string
          from_user: string
          to_user: string
          target_kind: ReactionKind
          target_key: string
          emoji: ReactionEmoji
          created_at: string
          seen_at: string | null
        }
        Insert: { [_ in never]: never }
        Update: { [_ in never]: never }
        Relationships: []
      }
      ai_chat_messages: {
        Row: {
          id: string
          seq: number
          user_id: string
          role: AiChatRole
          content: string
          interaction_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          role: AiChatRole
          content: string
          interaction_id?: string | null
          created_at?: string
        }
        Update: { [_ in never]: never }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          id: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent: string | null
          created_at: string
          last_success_at: string | null
          failure_count: number
        }
        Insert: {
          id?: string
          user_id?: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent?: string | null
          created_at?: string
          last_success_at?: string | null
          failure_count?: number
        }
        Update: {
          last_success_at?: string | null
          failure_count?: number
        }
        Relationships: []
      }
      notification_settings: {
        Row: {
          user_id: string
          pair_invites: boolean
          reactions: boolean
          plan_reminder: boolean
          reminder_time: string
          behind_nudge: boolean
          tz: string
          updated_at: string
        }
        Insert: {
          user_id?: string
          pair_invites?: boolean
          reactions?: boolean
          plan_reminder?: boolean
          reminder_time?: string
          behind_nudge?: boolean
          tz?: string
          updated_at?: string
        }
        Update: {
          pair_invites?: boolean
          reactions?: boolean
          plan_reminder?: boolean
          reminder_time?: string
          behind_nudge?: boolean
          tz?: string
        }
        Relationships: []
      }
      push_log: {
        Row: { user_id: string; key: string; sent_at: string }
        Insert: { user_id: string; key: string; sent_at?: string }
        Update: { sent_at?: string }
        Relationships: []
      }
      // 0030_invite_links.sql
      app_settings: {
        Row: {
          id: boolean
          members_can_invite: boolean
          max_active_invites_per_user: number
          updated_at: string
        }
        Insert: {
          id?: boolean
          members_can_invite?: boolean
          max_active_invites_per_user?: number
          updated_at?: string
        }
        Update: {
          members_can_invite?: boolean
          max_active_invites_per_user?: number
          updated_at?: string
        }
        Relationships: []
      }
      invite_codes: {
        Row: {
          id: string
          code: string
          created_by: string
          created_at: string
          expires_at: string
          max_uses: number
          uses: number
          revoked: boolean
          used_by: string | null
          used_at: string | null
        }
        Insert: {
          id?: string
          code: string
          created_by: string
          created_at?: string
          expires_at?: string
          max_uses?: number
          uses?: number
          revoked?: boolean
          used_by?: string | null
          used_at?: string | null
        }
        Update: {
          revoked?: boolean
          uses?: number
          used_by?: string | null
          used_at?: string | null
        }
        Relationships: []
      }
      invite_attempts: {
        Row: { id: number; key: string; created_at: string }
        Insert: { key: string; created_at?: string }
        Update: { created_at?: string }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      is_active: { Args: Record<PropertyKey, never>; Returns: boolean }
      save_workout_session: { Args: { payload: Json }; Returns: boolean }
      last_exercise_sets: {
        Args: {
          p_exercise_ids: string[]
          p_exclude_session?: string | null
          p_before?: string | null
        }
        Returns: {
          exercise_id: string
          session_id: string
          ended_at: string
          set_index: number
          is_warmup: boolean
          weight_kg: number | null
          reps: number | null
          rir: number | null
          duration_s: number | null
          distance_m: number | null
          calories: number | null
        }[]
      }
      set_commitment: {
        Args: {
          p_valid_from: string
          p_sessions_per_week: number
          p_minutes_per_week?: number | null
          p_by_type?: Json | null
          p_counts_free_activities?: boolean
        }
        Returns: string
      }
      // 0015_profile_settings_commitment_end.sql
      end_commitment: { Args: { p_today: string }; Returns: number }
      shares_with_me: { Args: { p_owner: string; p_perm: string }; Returns: boolean }
      are_linked: { Args: { p_a: string; p_b: string }; Returns: boolean }
      invite_partner: { Args: { p_email: string }; Returns: string }
      respond_partner_link: { Args: { p_partner: string; p_accept: boolean }; Returns: undefined }
      revoke_partner_link: { Args: { p_partner: string }; Returns: undefined }
      // 0027: sustituye a list_partner_links (0012)
      list_partners: {
        Args: Record<PropertyKey, never>
        Returns: {
          partner_id: string
          display_name: string | null
          status: 'sent' | 'received' | 'accepted'
          i_share_adherence: boolean
          i_share_sessions: boolean
          i_share_muscles: boolean
          i_share_achievements: boolean
          i_share_metrics: boolean
          they_share_adherence: boolean
          they_share_sessions: boolean
          they_share_muscles: boolean
          they_share_achievements: boolean
          they_share_metrics: boolean
          created_at: string
        }[]
      }
      partner_adherence_days: {
        Args: { p_partner: string; p_from: string; p_tz?: string }
        Returns: { day: string; session_type: SessionType }[]
      }
      // 0027_partner_sharing.sql
      partner_session_log: {
        Args: { p_partner: string }
        Returns: {
          id: string
          session_type: SessionType
          started_at: string
          ended_at: string
          duration_min: number | null
          rpe: number | null
          distance_m: number | null
          tonnage_kg: number | null
          total_reps: number | null
        }[]
      }
      // 0031_activity_types.sql: partner_session_log + activity_type_id.
      partner_sessions: {
        Args: { p_partner: string }
        Returns: {
          id: string
          session_type: SessionType
          activity_type_id: string | null
          started_at: string
          ended_at: string
          duration_min: number | null
          rpe: number | null
          distance_m: number | null
          tonnage_kg: number | null
          total_reps: number | null
        }[]
      }
      partner_exercise_sets: {
        Args: { p_partner: string; p_from: string; p_to: string }
        Returns: { session_id: string; exercise_id: string; sets: number }[]
      }
      partner_home: {
        Args: { p_partner: string }
        Returns: { home_city: string | null; home_lat: number | null; home_lng: number | null }[]
      }
      create_pair_invite: {
        Args: { p_partner: string; p_pair_group_id: string; p_payload: Json }
        Returns: string
      }
      update_pair_invite: { Args: { p_invite: string; p_payload: Json }; Returns: undefined }
      respond_pair_invite: { Args: { p_invite: string; p_accept: boolean }; Returns: undefined }
      cancel_pair_invite: { Args: { p_invite: string }; Returns: undefined }
      toggle_reaction: {
        Args: { p_to: string; p_kind: ReactionKind; p_key: string; p_emoji: ReactionEmoji }
        Returns: boolean
      }
      mark_reactions_seen: { Args: Record<PropertyKey, never>; Returns: number }
      session_totals: {
        Args: Record<PropertyKey, never>
        Returns: { session_id: string; tonnage_kg: number; total_reps: number }[]
      }
      // 0016_muscle_volume.sql
      session_exercise_sets: {
        Args: { p_from: string; p_to: string }
        Returns: { session_id: string; exercise_id: string; sets: number }[]
      }
      // 0017_plans.sql (0024: p_source y p_notes)
      create_user_plan: {
        Args: {
          p_template_id: string | null
          p_name: string
          p_start_date: string
          p_sessions: Json
          p_source?: PlanSource
          p_notes?: string | null
        }
        Returns: string
      }
      set_planned_session_done: {
        Args: { p_planned: string; p_done: boolean; p_workout?: string | null }
        Returns: undefined
      }
      // 0023_phase5b.sql
      recent_exercise_sets: {
        Args: {
          p_exercise_ids: string[]
          p_sessions?: number
          p_exclude_session?: string | null
        }
        Returns: {
          exercise_id: string
          session_id: string
          ended_at: string
          set_index: number
          is_warmup: boolean
          weight_kg: number | null
          reps: number | null
          rir: number | null
          duration_s: number | null
          distance_m: number | null
          calories: number | null
        }[]
      }
      // 0024_ai_coach.sql
      ai_calls_today: { Args: { p_tz?: string }; Returns: number }
      begin_ai_interaction: {
        Args: {
          p_kind: AiInteractionKind
          p_input_summary: Json
          p_daily_limit: number
          p_tz?: string
          p_provider?: string | null
          p_model?: string | null
          p_period?: string | null
        }
        Returns: string
      }
      finish_ai_interaction: {
        Args: {
          p_id: string
          p_status: Exclude<AiInteractionStatus, 'pending'>
          p_output?: Json | null
          p_tokens_in?: number | null
          p_tokens_out?: number | null
          p_error?: string | null
          p_model?: string | null
        }
        Returns: undefined
      }
      apply_daily_adjust: { Args: { p_interaction: string; p_planned: string }; Returns: string }
      revert_daily_adjust: { Args: { p_planned: string }; Returns: undefined }
      save_chat_turn: { Args: { p_interaction: string; p_user_text: string }; Returns: undefined }
      respond_ai_change: {
        Args: { p_interaction: string; p_index: number; p_accept: boolean }
        Returns: string
      }
      // 0033_chat_actions.sql
      link_chat_plan: { Args: { p_chat: string; p_plan: string }; Returns: undefined }
      accept_chat_plan: {
        Args: { p_chat: string; p_name: string; p_start_date: string; p_sessions: Json }
        Returns: Json
      }
      apply_chat_adjust: {
        Args: { p_chat: string; p_adjust: string; p_planned: string }
        Returns: Json
      }
      discard_chat_action: { Args: { p_chat: string; p_key: string }; Returns: undefined }
      // 0034_chat_ranges.sql
      respond_chat_range: {
        Args: {
          p_chat: string
          p_index: number
          p_accept: boolean
          p_dates?: string[] | null
          p_allow_conflicts?: boolean
        }
        Returns: Json
      }
      // 0028_push_notifications.sql
      save_push_subscription: {
        Args: { p_endpoint: string; p_p256dh: string; p_auth: string; p_user_agent?: string | null }
        Returns: string
      }
      // 0030_invite_links.sql
      my_invite_status: {
        Args: Record<PropertyKey, never>
        Returns: {
          can_invite: boolean
          is_admin: boolean
          max_active: number | null
          active_count: number
        }[]
      }
      create_invite_code: {
        Args: { p_expires_days?: number; p_max_uses?: number }
        Returns: Database['public']['Tables']['invite_codes']['Row']
      }
      revoke_invite_code: { Args: { p_id: string }; Returns: undefined }
      list_invite_codes: {
        Args: { p_all?: boolean }
        Returns: {
          id: string
          code: string
          created_by: string
          created_by_name: string | null
          created_at: string
          expires_at: string
          max_uses: number
          uses: number
          revoked: boolean
          used_by: string | null
          used_by_name: string | null
          used_at: string | null
          state: InviteCodeState
        }[]
      }
      set_invite_settings: {
        Args: { p_members_can_invite: boolean; p_max_active: number }
        Returns: undefined
      }
      normalize_invite_code: { Args: { p_code: string }; Returns: string }
      // Solo service role (servidor).
      lookup_invite_code: {
        Args: { p_code: string }
        Returns: {
          state: InviteCodeState | 'not_found' | 'inviter_inactive'
          code: string | null
          inviter_id: string | null
          inviter_name: string | null
        }[]
      }
      redeem_invite_code: {
        Args: { p_code: string; p_user: string }
        Returns: 'linked' | 'already_linked'
      }
      invite_attempts_count: { Args: { p_key: string; p_window_s: number }; Returns: number }
      record_invite_attempt: { Args: { p_key: string }; Returns: undefined }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

type PublicSchema = Database['public']

export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row']
export type TablesInsert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Update']

export type Profile = Tables<'profiles'>
export type TrainingProfile = Tables<'training_profiles'>
export type MuscleRow = Tables<'muscles'>
export type ExerciseRow = Tables<'exercises'>
export type WorkoutSessionRow = Tables<'workout_sessions'>
export type SessionBlockRow = Tables<'session_blocks'>
export type ExerciseSetRow = Tables<'exercise_sets'>
export type PersonalRecordRow = Tables<'personal_records'>
export type BodyMetricRow = Tables<'body_metrics'>
export type ProgressPhotoRow = Tables<'progress_photos'>
export type CommitmentRow = Tables<'commitments'>
export type PartnerLinkRow = Tables<'partner_links'>
export type EquivalenceObjectRow = Tables<'equivalence_objects'>
export type DestinationRow = Tables<'destinations'>
export type MilestoneShownRow = Tables<'milestones_shown'>
export type PlanTemplateRow = Tables<'plan_templates'>
export type UserPlanRow = Tables<'user_plans'>
export type PlannedSessionRow = Tables<'planned_sessions'>
export type DailyCheckinRow = Tables<'daily_checkins'>
export type AiInteractionRow = Tables<'ai_interactions'>
export type AiChatMessageRow = Tables<'ai_chat_messages'>
export type PairInviteRow = Tables<'pair_invites'>
export type ReactionRow = Tables<'reactions'>
export type PushSubscriptionRow = Tables<'push_subscriptions'>
export type NotificationSettingsRow = Tables<'notification_settings'>
export type AppSettingsRow = Tables<'app_settings'>
export type InviteCodeRow = Tables<'invite_codes'>
export type ActivityTypeRow = Tables<'activity_types'>
