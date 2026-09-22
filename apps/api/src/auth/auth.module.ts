import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccountLinkService } from './account-link.service';
import { InviteService } from './invite.service';
import { FirebaseVerifier } from './firebase';
import { AccountBans } from './account-bans';
import { loadEnv } from '../config/env';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: loadEnv().JWT_SECRET,
        signOptions: { algorithm: 'HS256', issuer: 'sinchi' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'sinchi' },
      }),
      global: true,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AccountLinkService, InviteService, FirebaseVerifier, AccountBans],
  exports: [AuthService, AccountLinkService, InviteService, FirebaseVerifier, AccountBans],
})
export class AuthModule {}
