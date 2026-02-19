export interface GlobalChatReactionUser {
  userId: string;
  label: string;
}

export interface GlobalChatReaction {
  emoji: string;
  users: GlobalChatReactionUser[];
}

export interface GlobalChatMessage {
  id: number;
  userId: string;
  senderLabel: string;
  senderAvatarUrl: string | null;
  senderAvatarBorderColor: string | null;
  message: string;
  imageUrl: string | null;
  reactions: GlobalChatReaction[];
  createdAt: string;
}
