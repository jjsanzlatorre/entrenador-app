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
  | 'padel_fronton'
  | 'surf'
  | 'other'
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
export type EquivalenceKind = 'weight' | 'distance_route' | 'time'
export type DestinationType = 'city' | 'island' | 'landmark'

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
          can_view_metrics?: boolean
        }
        Update: {
          can_view_adherence?: boolean
          can_view_sessions?: boolean
          can_view_metrics?: boolean
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
      invite_partner: { Args: { p_email: string }; Returns: string }
      respond_partner_link: { Args: { p_partner: string; p_accept: boolean }; Returns: undefined }
      revoke_partner_link: { Args: { p_partner: string }; Returns: undefined }
      list_partner_links: {
        Args: Record<PropertyKey, never>
        Returns: {
          partner_id: string
          display_name: string | null
          status: 'sent' | 'received' | 'accepted'
          i_share_adherence: boolean
          i_share_sessions: boolean
          i_share_metrics: boolean
          they_share_adherence: boolean
          they_share_sessions: boolean
          they_share_metrics: boolean
          created_at: string
        }[]
      }
      partner_adherence_days: {
        Args: { p_partner: string; p_from: string; p_tz?: string }
        Returns: { day: string; session_type: SessionType }[]
      }
      session_totals: {
        Args: Record<PropertyKey, never>
        Returns: { session_id: string; tonnage_kg: number; total_reps: number }[]
      }
      // 0016_muscle_volume.sql
      session_exercise_sets: {
        Args: { p_from: string; p_to: string }
        Returns: { session_id: string; exercise_id: string; sets: number }[]
      }
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
