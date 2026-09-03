/**
 * Modulo raiz.
 *
 * El guard de sesion se registra GLOBAL: asi una ruta nueva nace protegida y
 * hay que marcarla `@Public()` para abrirla. Al contrario —abierta por defecto y
 * protegida a mano— el olvido se paga con una fuga de datos.
 *
 * El de la suscripcion a Sinchi va igual y por la misma razon: una ruta de
 * escritura nueva nace cortada para el gimnasio que no pago, y abrirla exige
 * `@AllowedWhenReadOnly()`. Al reves, cada ruta nueva regalaria el producto sin
 * que nada fallara.
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
import { RefreshSaasJob } from './jobs/refresh-saas.job';
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
import { GymsController } from './modules/gyms.controller';
import { TrialsService } from './modules/trials/trials.service';
import { SaasService } from './modules/saas/saas.service';
import { OnboardingService } from './modules/onboarding/onboarding.service';
import { OfferingController } from './modules/offering/offering.controller';
import { PlansService } from './modules/offering/plans.service';
import { GymSettingsService } from './modules/offering/settings.service';
import { EventsController } from './modules/events/events.controller';
import { EventsService } from './modules/events/events.service';
import { EventRegistrationsService } from './modules/events/registrations.service';
import { VisitorService } from './modules/identity/visitor.service';
import { SaasGuard } from './modules/saas/saas.guard';

@Module({
  imports: [DbModule, CommonModule, AuthModule, ScheduleModule.forRoot()],
  controllers: [
    BrandController,
    HealthController,
    StudentController,
    StaffController,
    OfferingController,
    EventsController,
    GymsController,
    AccountsController,
    InvitesController,
    JobsController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    // Despues del de sesion, y no antes: necesita saber en que gimnasio trabaja
    // quien escribe, y eso lo deja puesto `AuthGuard`.
    { provide: APP_GUARD, useClass: SaasGuard },
    MembershipViewService,
    IdentityService,
    MembersService,
    CheckInService,
    BillingService,
    MailService,
    TrialsService,
    SaasService,
    OnboardingService,
    PlansService,
    GymSettingsService,
    EventsService,
    EventRegistrationsService,
    VisitorService,
    RefreshDelinquencyJob,
    RefreshSaasJob,
  ],
})
export class AppModule {}
