export interface GlobalChatMessage {
  id: number;
  userId: string;
  senderLabel: string;
  senderAvatarUrl: string | null;
  message: string;
  createdAt: string;
}
