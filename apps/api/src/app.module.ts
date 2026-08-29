/**
 * Modulo raiz.
 *
 * El guard de sesion se registra GLOBAL: asi una ruta nueva nace protegida y
 * hay que marcarla `@Public()` para abrirla. Al contrario —abierta por defecto y
 * protegida a mano— el olvido se paga con una fuga de datos.
 */
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { DbModule } from './db/db.module';
import { AccountsController } from './modules/accounts.controller';
import { InvitesController } from './modules/invites.controller';
import { JobsController } from './jobs/jobs.controller';
import { RefreshDelinquencyJob } from './jobs/refresh-delinquency.job';
import { BillingService } from './modules/billing/billing.service';
import { MailService } from './modules/mail/mail.service';
import { BrandController } from './modules/brand.controller';
import { CheckInService } from './modules/checkin/checkin.service';
import { HealthController } from './modules/health.controller';
import { IdentityService } from './modules/identity/identity.service';
import { MembersService } from './modules/members/members.service';
import { MembershipViewService } from './modules/memberships/membership-view.service';
import { StaffController } from './modules/staff.controller';
import { StudentController } from './modules/student.controller';

@Module({
  imports: [DbModule, CommonModule, AuthModule, ScheduleModule.forRoot()],
  controllers: [
    BrandController,
    HealthController,
    StudentController,
    StaffController,
    AccountsController,
    InvitesController,
    JobsController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    MembershipViewService,
    IdentityService,
    MembersService,
    CheckInService,
    BillingService,
    MailService,
    RefreshDelinquencyJob,
  ],
})
export class AppModule {}
