import { Request, Response, NextFunction } from "express";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userIdHeader = req.headers["x-user-id"] as string | undefined;
  const authHeader = req.headers["authorization"] as string | undefined;

  let userId: string | null = null;

  if (userIdHeader && userIdHeader.trim().length > 0) {
    userId = userIdHeader.trim();
  } else if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    if (token.length > 0) {
      userId = token;
    }
  }

  if (!userId) {
    // Fallback ID for unauthenticated request to prevent shared state
    userId = `guest-${Math.random().toString(36).substring(2, 10)}`;
  }

  (req as any).user = {
    id: userId,
    email: `${userId}@guest.repogpt`,
  };
  next();
}
