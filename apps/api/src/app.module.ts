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
import { AccountDeletionService } from './modules/identity/account-deletion.service';
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
import { SchedulesService } from './modules/offering/schedules.service';
import { GymSettingsService } from './modules/offering/settings.service';
import { GymLogoService } from './modules/offering/logo.service';
import { EventsController } from './modules/events/events.controller';
import { EventsService } from './modules/events/events.service';
import { EventRegistrationsService } from './modules/events/registrations.service';
import { RoutinesController } from './modules/routines/routines.controller';
import { RoutinesService } from './modules/routines/routines.service';
import { videoStorageProvider } from './modules/routines/video-storage';
import { VisitorService } from './modules/identity/visitor.service';
import { LinkRequestsService } from './modules/identity/link-requests.service';
import { LinkRequestsController } from './modules/link-requests.controller';
import { MessagingService } from './modules/messaging/messaging.service';
import { PlacesController } from './modules/places/places.controller';
import { PlacesService } from './modules/places/places.service';
import { SaasGuard } from './modules/saas/saas.guard';
import { AdminController, AdminPanelController } from './modules/admin/admin.controller';
import { PlatformAdminGuard } from './modules/admin/admin.guard';
import { PlatformAdminService } from './modules/admin/platform-admin.service';
import { PlatformGymsService } from './modules/admin/platform-gyms.service';
import { PlatformPromosService } from './modules/admin/platform-promos.service';
import { PlatformPeopleService } from './modules/admin/platform-people.service';

@Module({
  imports: [DbModule, CommonModule, AuthModule, ScheduleModule.forRoot()],
  controllers: [
    BrandController,
    HealthController,
    StudentController,
    StaffController,
    OfferingController,
    EventsController,
    RoutinesController,
    GymsController,
    PlacesController,
    AccountsController,
    InvitesController,
    LinkRequestsController,
    JobsController,
    // El panel de Sinchi. Dos controladores con el mismo prefijo: uno para la
    // ruta que CREA la sesion y otro para todo lo demas, que nace detras del
    // guard por estar en esa clase (ver admin.controller.ts).
    AdminController,
    AdminPanelController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    // Despues del de sesion, y no antes: necesita saber en que gimnasio trabaja
    // quien escribe, y eso lo deja puesto `AuthGuard`.
    { provide: APP_GUARD, useClass: SaasGuard },
    MembershipViewService,
    IdentityService,
    AccountDeletionService,
    MembersService,
    CheckInService,
    BillingService,
    MailService,
    TrialsService,
    SaasService,
    OnboardingService,
    PlansService,
    SchedulesService,
    GymSettingsService,
    GymLogoService,
    EventsService,
    EventRegistrationsService,
    RoutinesService,
    PlacesService,
    videoStorageProvider,
    VisitorService,
    LinkRequestsService,
    MessagingService,
    RefreshDelinquencyJob,
    RefreshSaasJob,
    PlatformAdminService,
    PlatformGymsService,
    PlatformPromosService,
    PlatformPeopleService,
    PlatformAdminGuard,
  ],
})
export class AppModule {}
