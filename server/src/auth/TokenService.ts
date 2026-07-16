import jwt from 'jsonwebtoken';

export interface PlayerClaims {
  sub: string;
  deviceId: string;
  type: 'player';
}

export class TokenService {
  constructor(private readonly secret: string) {}

  issue(playerId: string, deviceId: string): string {
    return jwt.sign({ deviceId, type: 'player' }, this.secret, {
      subject: playerId,
      issuer: 'neural-evolution-server',
      audience: 'neural-evolution-client',
      expiresIn: '30d',
    });
  }

  verify(token: string): PlayerClaims {
    const decoded = jwt.verify(token, this.secret, {
      issuer: 'neural-evolution-server',
      audience: 'neural-evolution-client',
    });
    if (typeof decoded === 'string' || !decoded.sub || decoded.type !== 'player' || typeof decoded.deviceId !== 'string') {
      throw new Error('Invalid player token');
    }
    return { sub: decoded.sub, deviceId: decoded.deviceId, type: 'player' };
  }
}
