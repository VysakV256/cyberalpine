#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "CyberquestUniverse.generated.h"
class UProceduralMeshComponent;
class UInstancedStaticMeshComponent;
class UStaticMeshComponent;
class UMaterialInterface;
class FJsonObject;

struct FCyberquestDataset
{
    FString Id, Name, Structure, Form, SourceUrl;
    FVector2D Anchor = FVector2D::ZeroVector;
    float Radius = 12.f, Relief = 12.f, Abundance = .5f;
    FLinearColor Color = FLinearColor(.22f, .45f, .30f);
};
struct FCyberquestDebris
{
    FVector Position = FVector::ZeroVector; // East, north, up; metres.
    FVector Velocity = FVector::ZeroVector; // metres / second.
    float Age = 0.f;
};
struct FCyberquestLake
{
    FString Id, Name;
    FVector2D Center=FVector2D::ZeroVector;
    float Radius=14.f, WaterLevel=7.4f, Depth=4.f;
};

UCLASS(Blueprintable)
class CYBERQUESTUNREAL_API ACyberquestUniverse : public AActor
{
    GENERATED_BODY()
public:
    ACyberquestUniverse();
    virtual void Tick(float DeltaSeconds) override;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Cyberquest") FString ManifestRelativePath = TEXT("Data/universe.json");
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Cyberquest", meta=(ClampMin="32", ClampMax="256")) int32 GridResolution = 144;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Cyberquest") bool bAllowFixtureFallback = false;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Cyberquest") FString SourceSummary;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Cyberquest") FString DataWindow;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Cyberquest") UProceduralMeshComponent* Terrain;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Cyberquest") UProceduralMeshComponent* Rivers;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Cyberquest") UProceduralMeshComponent* Glaciers;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Cyberquest") UInstancedStaticMeshComponent* Trunks;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Cyberquest") UInstancedStaticMeshComponent* Canopies;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Cyberquest") UInstancedStaticMeshComponent* AvalancheRocks;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Cyberquest") UProceduralMeshComponent* LakesMesh;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Cyberquest") UInstancedStaticMeshComponent* DockTimber;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Cyberquest") UStaticMeshComponent* Boat;
    UFUNCTION(BlueprintCallable, CallInEditor, Category="Cyberquest") bool RebuildUniverse();
    UFUNCTION(BlueprintPure, Category="Cyberquest") float GetHeightMetres(float East, float North) const;
    UFUNCTION(BlueprintPure, Category="Cyberquest") FVector GetSurfaceNormal(float East, float North) const;
    UFUNCTION(BlueprintCallable, Category="Cyberquest") bool TriggerAvalanche(const FString& DatasetId, int32 ParticleCount = 32);
    UFUNCTION(BlueprintPure, Category="Cyberquest|Lake") bool GetLakeNavigation(const FString& LakeId, FVector& CenterMetres, float& NavigableRadiusMetres) const;
    UFUNCTION(BlueprintCallable, Category="Cyberquest|Lake") bool SetBoatPose(FVector PositionMetres, float YawRadians);
protected:
    virtual void BeginPlay() override;
private:
    TArray<FCyberquestDataset> Datasets;
    TArray<FCyberquestDebris> Debris;
    TArray<FCyberquestLake> Lakes;
    TSharedPtr<FJsonObject> Manifest;
    float Baseline = 8.f, Extent = 76.f;
    FVector2D Gradient(float East, float North) const;
    const FCyberquestDataset* FindDataset(const FString& Id) const;
    bool LoadManifest();
    void BuildTerrain();
    void BuildForests();
    void BuildRivers();
    void BuildGlaciers();
    void BuildLakes();
    float LakeBoundaryRadius(const FCyberquestLake& Lake, float Angle, float Clearance = 0.f) const;
    void ApplyMaterials();
};
