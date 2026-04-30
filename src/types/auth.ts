export type GoogleAppAuthState =
  | 'signed_out'
  | 'signed_in'
  | 'signed_in_drive_connected';

export type GoogleSignedInUser = {
  googleUserId: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
};

export type GoogleAuthActionResult<T = undefined> = {
  data?: T;
  message: string;
  status: 'error' | 'success';
};
