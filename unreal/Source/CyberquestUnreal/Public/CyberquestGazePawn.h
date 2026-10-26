#pragma once
#include "CoreMinimal.h"
#include "GameFramework/SpectatorPawn.h"
#include "CyberquestGazePawn.generated.h"
class UCameraComponent;
class ACyberquestUniverse;
UCLASS()
class CYBERQUESTUNREAL_API ACyberquestGazePawn : public ASpectatorPawn
{
    GENERATED_BODY()
public:
    ACyberquestGazePawn();
    virtual void Tick(float DeltaSeconds) override;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Cyberquest") UCameraComponent* GazeCamera;
    // External hyperemergence boundary. Position = (east, north, up) metres.
    // Yaw clockwise from north; pitch positive up; both radians. FOV degrees.
    UFUNCTION(BlueprintCallable, Category="Cyberquest|External Gaze") void SetGaze(FVector PositionMetres, float YawRadians, float PitchRadians, float FovDegrees = 72.f);
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Cyberquest|Lake") bool bInBoat=false;
    UFUNCTION(BlueprintCallable, Category="Cyberquest|Lake") bool EnterBoat(const FString& LakeId);
    UFUNCTION(BlueprintCallable, Category="Cyberquest|Lake") void ExitBoat();
protected:
    virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;
private:
    void ToggleBoat();
    TWeakObjectPtr<ACyberquestUniverse> BoatUniverse;
    FVector BoatCenter=FVector::ZeroVector,PreviousLocation=FVector::ZeroVector;
    FRotator PreviousRotation=FRotator::ZeroRotator;
    float BoatRadius=0,PreviousMaxSpeed=1200.f;
};
