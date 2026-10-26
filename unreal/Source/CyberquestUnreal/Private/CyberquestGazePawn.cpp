#include "CyberquestGazePawn.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/Controller.h"
#include "GameFramework/FloatingPawnMovement.h"
#include "GameFramework/PawnMovementComponent.h"
#include "Components/InputComponent.h"
#include "CyberquestUniverse.h"
#include "EngineUtils.h"
ACyberquestGazePawn::ACyberquestGazePawn()
{
    GazeCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("GazeCamera"));
    GazeCamera->SetupAttachment(GetRootComponent());
    GazeCamera->bUsePawnControlRotation = true;
    GazeCamera->FieldOfView = 72.f;
}
void ACyberquestGazePawn::SetGaze(FVector PositionMetres, float YawRadians, float PitchRadians, float FovDegrees)
{
    if (PositionMetres.ContainsNaN() || !FMath::IsFinite(YawRadians) || !FMath::IsFinite(PitchRadians) || !FMath::IsFinite(FovDegrees)) return;
    if(bInBoat)ExitBoat();
    const FRotator Rotation(FMath::Clamp(FMath::RadiansToDegrees(PitchRadians), -89.f, 89.f), 90.f - FMath::RadiansToDegrees(YawRadians), 0.f);
    SetActorLocationAndRotation(PositionMetres * 100.f, Rotation, false, nullptr, ETeleportType::TeleportPhysics);
    if (Controller) Controller->SetControlRotation(Rotation);
    GazeCamera->FieldOfView = FMath::Clamp(FovDegrees, 25.f, 120.f);
}
void ACyberquestGazePawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);
    PlayerInputComponent->BindAction(TEXT("ToggleBoat"),IE_Pressed,this,&ACyberquestGazePawn::ToggleBoat);
}
void ACyberquestGazePawn::ToggleBoat() { if(bInBoat)ExitBoat();else EnterBoat(TEXT("")); }
bool ACyberquestGazePawn::EnterBoat(const FString& LakeId)
{
    if(bInBoat)return true;
    for(TActorIterator<ACyberquestUniverse> It(GetWorld());It;++It)
    {
        FVector Center;float Radius;if(!It->GetLakeNavigation(LakeId,Center,Radius))continue;
        PreviousLocation=GetActorLocation();PreviousRotation=Controller?Controller->GetControlRotation():GetActorRotation();
        BoatUniverse=*It;BoatCenter=Center;BoatRadius=Radius;bInBoat=true;
        SetActorLocation((Center+FVector(Radius*.55f,-1.5f,1.25f))*100,false,nullptr,ETeleportType::TeleportPhysics);
        if(auto* Movement=GetMovementComponent())
        {
            Movement->StopMovementImmediately();Movement->SetPlaneConstraintOrigin(FVector(0,0,(Center.Z+1.25f)*100));
            Movement->SetPlaneConstraintNormal(FVector::UpVector);Movement->SetPlaneConstraintEnabled(true);
            if(auto* Floating=Cast<UFloatingPawnMovement>(Movement)) { PreviousMaxSpeed=Floating->MaxSpeed;Floating->MaxSpeed=300.f; }
        }
        return true;
    }
    return false;
}
void ACyberquestGazePawn::ExitBoat()
{
    if(!bInBoat)return;bInBoat=false;BoatUniverse.Reset();
    if(auto* Movement=GetMovementComponent()) { Movement->StopMovementImmediately();Movement->SetPlaneConstraintEnabled(false);if(auto* Floating=Cast<UFloatingPawnMovement>(Movement))Floating->MaxSpeed=PreviousMaxSpeed; }
    SetActorLocationAndRotation(PreviousLocation,PreviousRotation,false,nullptr,ETeleportType::TeleportPhysics);
    if(Controller)Controller->SetControlRotation(PreviousRotation);
}
void ACyberquestGazePawn::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);if(!bInBoat)return;if(!BoatUniverse.IsValid()){ExitBoat();return;}
    FVector P=GetActorLocation()/100;FVector2D Delta(P.X-BoatCenter.X,P.Y-BoatCenter.Y);
    if(Delta.Size()>BoatRadius) { Delta=Delta.GetSafeNormal()*BoatRadius;P.X=BoatCenter.X+Delta.X;P.Y=BoatCenter.Y+Delta.Y;if(GetMovementComponent())GetMovementComponent()->StopMovementImmediately(); }
    P.Z=BoatCenter.Z+1.25f;SetActorLocation(P*100,false,nullptr,ETeleportType::TeleportPhysics);
    const float Yaw=Controller?Controller->GetControlRotation().Yaw:GetActorRotation().Yaw;
    BoatUniverse->SetBoatPose(P,PI/2-FMath::DegreesToRadians(Yaw));
}
