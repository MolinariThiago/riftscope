export interface UserProfile {
  id: string;
  email: string;
  username: string;
  subscription_tier: "free" | "pro";
  subscription_status: "active" | "inactive" | "past_due" | "canceled";
  avatar_url?: string;
  is_admin: boolean;
  created_at: string;
}

export interface LoginResponse {
  message: string;
  user: UserProfile;
  access_token: string;
  refresh_token: string;
}

export interface TokenResponse {
  access_token: string;
}
