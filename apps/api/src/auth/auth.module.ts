import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccountLinkService } from './account-link.service';
import { FirebaseVerifier } from './firebase';
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
  providers: [AuthService, AccountLinkService, FirebaseVerifier],
  exports: [AuthService, AccountLinkService],
})
export class AuthModule {}
