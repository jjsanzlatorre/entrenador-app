// Tipos de la base de datos escritos a mano (no se usa la CLI de Supabase).
// Mantener sincronizado con supabase/migrations/*. Sigue el formato de `supabase gen types`.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type UserRole = 'admin' | 'member'
export type Sex = 'male' | 'female' | 'other'
export type TrainingLevel = 'beginner' | 'intermediate' | 'advanced'

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
    }
    Views: { [_ in never]: never }
    Functions: {
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      is_active: { Args: Record<PropertyKey, never>; Returns: boolean }
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
