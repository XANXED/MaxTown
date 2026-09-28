export {};

declare global {
  interface Window {
    __VK_LAUNCH_PARAMS__?: string;
    __VK_USER_INFO__?: {
      first_name?: string;
      last_name?: string;
      photo_100?: string;
      photo_200?: string;
    };
  }
}
