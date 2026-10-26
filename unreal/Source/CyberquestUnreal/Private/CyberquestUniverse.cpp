#include "CyberquestUniverse.h"
#include "ProceduralMeshComponent.h"
#include "KismetProceduralMeshLibrary.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInterface.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/Crc.h"
#include "UObject/ConstructorHelpers.h"

DEFINE_LOG_CATEGORY_STATIC(LogCyberquest, Log, All);
namespace {
FString Text(const TSharedPtr<FJsonObject>& O, const TCHAR* Key, const FString& Fallback = TEXT(""))
{
    FString S; return O.IsValid() && O->TryGetStringField(Key, S) ? S.Left(2000) : Fallback;
}
float Number(const TSharedPtr<FJsonObject>& O, const TCHAR* Key, float Fallback, float Min = -1000000.f, float Max = 1000000.f)
{
    double V; return O.IsValid() && O->TryGetNumberField(Key, V) && FMath::IsFinite(V) ? FMath::Clamp(static_cast<float>(V), Min, Max) : Fallback;
}
TSharedPtr<FJsonObject> Object(const TSharedPtr<FJsonObject>& O, const TCHAR* Key)
{
    return O.IsValid() && O->HasTypedField<EJson::Object>(Key) ? O->GetObjectField(Key) : nullptr;
}
void Section(UProceduralMeshComponent* Mesh, int32 Index, const TArray<FVector>& V, const TArray<int32>& I, const TArray<FLinearColor>& Colors, bool Collision)
{
    TArray<FVector2D> UV; UV.Reserve(V.Num());
    for (const FVector& P : V) UV.Add(FVector2D(P.X, P.Y) / 1000.f);
    TArray<FVector> Normals; TArray<FProcMeshTangent> Tangents;
    UKismetProceduralMeshLibrary::CalculateTangentsForMesh(V, I, UV, Normals, Tangents);
    Mesh->CreateMeshSection_LinearColor(Index, V, I, Normals, UV, Colors, Tangents, Collision);
}
}

ACyberquestUniverse::ACyberquestUniverse()
{
    PrimaryActorTick.bCanEverTick = true;
    Terrain = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Terrain")); SetRootComponent(Terrain);
    Terrain->bUseAsyncCooking = true; Terrain->SetCollisionProfileName(TEXT("BlockAll"));
    Rivers = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("InformationRivers")); Rivers->SetupAttachment(Terrain);
    Glaciers = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("ArchiveGlaciers")); Glaciers->SetupAttachment(Terrain);
    Trunks = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("Trunks")); Trunks->SetupAttachment(Terrain);
    Canopies = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("Canopies")); Canopies->SetupAttachment(Terrain);
    AvalancheRocks = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("AvalancheRocks")); AvalancheRocks->SetupAttachment(Terrain);
    LakesMesh = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("DataLakes")); LakesMesh->SetupAttachment(Terrain);
    DockTimber = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("BoathousesAndDocks")); DockTimber->SetupAttachment(Terrain);
    Boat = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("InspectionBoat")); Boat->SetupAttachment(Terrain); Boat->SetMobility(EComponentMobility::Movable);
    Rivers->SetCollisionEnabled(ECollisionEnabled::NoCollision); Glaciers->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Trunks->SetCollisionEnabled(ECollisionEnabled::NoCollision); Canopies->SetCollisionEnabled(ECollisionEnabled::NoCollision); AvalancheRocks->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    LakesMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision); DockTimber->SetCollisionEnabled(ECollisionEnabled::NoCollision); Boat->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cylinder(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cone(TEXT("/Engine/BasicShapes/Cone.Cone"));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Sphere(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
    if (Cylinder.Succeeded()) Trunks->SetStaticMesh(Cylinder.Object);
    if (Cone.Succeeded()) Canopies->SetStaticMesh(Cone.Object);
    if (Sphere.Succeeded()) AvalancheRocks->SetStaticMesh(Sphere.Object);
    if (Cube.Succeeded()) { DockTimber->SetStaticMesh(Cube.Object); Boat->SetStaticMesh(Cube.Object); }
    Boat->SetVisibility(false);
}
void ACyberquestUniverse::BeginPlay() { Super::BeginPlay(); RebuildUniverse(); }
const FCyberquestDataset* ACyberquestUniverse::FindDataset(const FString& Id) const
{
    return Datasets.FindByPredicate([&](const FCyberquestDataset& D) { return D.Id == Id; });
}
bool ACyberquestUniverse::LoadManifest()
{
    Datasets.Reset(); Lakes.Reset(); Manifest.Reset();
    FString Json;
    const FString Filename = FPaths::Combine(FPaths::ProjectContentDir(), ManifestRelativePath);
    if (FFileHelper::LoadFileToString(Json, *Filename) && Json.Len() < 16000000)
        FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), Manifest);
    const TArray<TSharedPtr<FJsonValue>>* Items = nullptr;
    if (!Manifest.IsValid() || !Manifest->TryGetArrayField(TEXT("datasets"), Items) || !Items || Items->Num() == 0)
    {
        SourceSummary = TEXT("Manifest unavailable. No source data rendered.");
        UE_LOG(LogCyberquest, Error, TEXT("%s Read %s"), *SourceSummary, *Filename);
        if (!bAllowFixtureFallback) return false;
        FCyberquestDataset A; A.Id=TEXT("fixture-table"); A.Name=TEXT("ILLUSTRATIVE TABLE FIXTURE"); A.Structure=TEXT("tabular"); A.Form=TEXT("peak"); A.Anchor=FVector2D(-20,20); A.Relief=24;
        FCyberquestDataset B; B.Id=TEXT("fixture-graph"); B.Name=TEXT("ILLUSTRATIVE GRAPH FIXTURE"); B.Structure=TEXT("relational"); B.Form=TEXT("valley"); B.Anchor=FVector2D(20,-15); B.Relief=-6;
        Datasets.Add(A); Datasets.Add(B); SourceSummary=TEXT("FIXTURE MODE: no records fetched; explicit fallback enabled."); return true;
    }
    const TSharedPtr<FJsonObject> World = Object(Manifest, TEXT("world"));
    Baseline = Number(World, TEXT("baseline"), 8.f, 0.f, 100.f); Extent = Number(World, TEXT("extent"), 76.f, 30.f, 300.f);
    const auto Window = Object(Manifest, TEXT("window")); DataWindow = Text(Window,TEXT("start")) + TEXT(" to ") + Text(Window,TEXT("end"));
    TSet<FString> Ids;
    for (const auto& Value : *Items)
    {
        if (Datasets.Num() >= 64 || !Value.IsValid() || Value->Type != EJson::Object) continue;
        const auto O = Value->AsObject(); FCyberquestDataset D;
        D.Id=Text(O,TEXT("id")); if (D.Id.IsEmpty() || Ids.Contains(D.Id)) continue; Ids.Add(D.Id);
        D.Name=Text(O,TEXT("name"),D.Id); D.Structure=Text(O,TEXT("structure"),TEXT("relational"));
        D.Form=Text(O,TEXT("form"),D.Structure==TEXT("tabular")?TEXT("peak"):D.Structure==TEXT("object")?TEXT("foothill"):TEXT("valley"));
        const auto A=Object(O,TEXT("anchor")); D.Anchor=FVector2D(Number(A,TEXT("x"),0,-Extent,Extent), Number(A,TEXT("z"),0,-Extent,Extent));
        D.Radius=Number(O,TEXT("radius"),12,2,40); D.Relief=Number(O,TEXT("relief"),D.Form==TEXT("valley")?-5.f:15.f,-Baseline+.5f,80);
        D.Abundance=Number(O,TEXT("abundance"),.5f,0,1); D.SourceUrl=Text(O,TEXT("sourceUrl"));
        D.Color=D.Form==TEXT("peak")?FLinearColor(.42f,.32f,.20f):D.Form==TEXT("foothill")?FLinearColor(.19f,.38f,.22f):FLinearColor(.10f,.28f,.21f);
        Datasets.Add(D);
    }
    const TArray<TSharedPtr<FJsonValue>>* LakeItems=nullptr;
    if(Manifest->TryGetArrayField(TEXT("lakes"),LakeItems)) for(const auto& Value:*LakeItems)
    {
        if(Lakes.Num()>=8 || !Value.IsValid() || Value->Type!=EJson::Object)continue;
        const auto O=Value->AsObject(),Center=Object(O,TEXT("center")); FCyberquestLake L;
        L.Id=Text(O,TEXT("id"),FString::Printf(TEXT("lake-%d"),Lakes.Num()+1)); L.Name=Text(O,TEXT("name"),L.Id);
        L.Center=FVector2D(Number(Center,TEXT("x"),45,-Extent+18,Extent-18),Number(Center,TEXT("z"),-50,-Extent+18,Extent-18));
        L.Radius=Number(O,TEXT("radius"),14,5,18); L.Depth=Number(O,TEXT("depth"),4,1,7);
        L.WaterLevel=Number(O,TEXT("waterLevel"),Baseline-.6f,Baseline-L.Depth+.4f,Baseline-.15f); Lakes.Add(L);
    }
    SourceSummary=FString::Printf(TEXT("%d dataset homes; source records and mappings retained in manifest. Window %s."),Datasets.Num(),*DataWindow);
    UE_LOG(LogCyberquest, Display, TEXT("%s"),*SourceSummary); return Datasets.Num()>0;
}
float ACyberquestUniverse::GetHeightMetres(float East, float North) const
{
    float H=Baseline;
    for (const auto& D:Datasets) { const float Q=FVector2D::DistSquared(FVector2D(East,North),D.Anchor)/FMath::Square(D.Radius); if(Q<1) H+=D.Relief*FMath::Pow(1-Q,3); }
    for(const auto& L:Lakes) { const float Q=FVector2D::DistSquared(FVector2D(East,North),L.Center)/FMath::Square(L.Radius); if(Q<1)H-=L.Depth*FMath::Pow(1-Q,3); }
    return H;
}
FVector2D ACyberquestUniverse::Gradient(float East,float North) const
{
    FVector2D G=FVector2D::ZeroVector;
    for(const auto& D:Datasets) { const FVector2D Delta=FVector2D(East,North)-D.Anchor; const float Q=Delta.SizeSquared()/FMath::Square(D.Radius); if(Q<1) G+=Delta*(-6*D.Relief*FMath::Square(1-Q)/FMath::Square(D.Radius)); }
    for(const auto& L:Lakes) { const FVector2D Delta=FVector2D(East,North)-L.Center;const float Q=Delta.SizeSquared()/FMath::Square(L.Radius);if(Q<1)G+=Delta*(6*L.Depth*FMath::Square(1-Q)/FMath::Square(L.Radius)); }
    return G;
}
FVector ACyberquestUniverse::GetSurfaceNormal(float East,float North) const { const auto G=Gradient(East,North); return FVector(-G.X,-G.Y,1).GetSafeNormal(); }
void ACyberquestUniverse::ApplyMaterials()
{
    auto Material=[](const TCHAR* Name) { return LoadObject<UMaterialInterface>(nullptr,*FString::Printf(TEXT("/Game/Cyberquest/Materials/%s.%s"),Name,Name)); };
    if(auto* M=Material(TEXT("M_Terrain"))) Terrain->SetMaterial(0,M);
    if(auto* M=Material(TEXT("M_Water"))) for(int32 I=0;I<Rivers->GetNumSections();++I) Rivers->SetMaterial(I,M);
    if(auto* M=Material(TEXT("M_Ice"))) for(int32 I=0;I<Glaciers->GetNumSections();++I) Glaciers->SetMaterial(I,M);
    if(auto* M=Material(TEXT("M_Bark"))) Trunks->SetMaterial(0,M);
    if(auto* M=Material(TEXT("M_Leaves"))) Canopies->SetMaterial(0,M);
    if(auto* M=Material(TEXT("M_Rock"))) AvalancheRocks->SetMaterial(0,M);
    if(auto* M=Material(TEXT("M_Water"))) for(int32 I=0;I<LakesMesh->GetNumSections();++I)LakesMesh->SetMaterial(I,M);
    if(auto* M=Material(TEXT("M_Bark"))) DockTimber->SetMaterial(0,M);
    if(auto* M=Material(TEXT("M_Boat"))) Boat->SetMaterial(0,M);
}
void ACyberquestUniverse::BuildTerrain()
{
    const int32 N=FMath::Clamp(GridResolution,32,256); TArray<FVector> V; TArray<int32> I; TArray<FLinearColor> C;
    V.Reserve((N+1)*(N+1)); C.Reserve((N+1)*(N+1));
    for(int32 Y=0;Y<=N;++Y) for(int32 X=0;X<=N;++X)
    {
        const float E=-Extent+2*Extent*X/N, North=-Extent+2*Extent*Y/N, H=GetHeightMetres(E,North); V.Add(FVector(E,North,H)*100);
        FLinearColor Color(.15f,.23f,.17f);
        for(const auto& D:Datasets) if(FVector2D::DistSquared(FVector2D(E,North),D.Anchor)<FMath::Square(D.Radius)) { Color=D.Color; break; }
        const float Light=.75f+.25f*GetSurfaceNormal(E,North).Z; C.Add(Color*Light);
        if(X<N && Y<N) { const int32 A=Y*(N+1)+X,B=A+1,D=A+N+1,Ei=D+1; I.Append({A,B,D,B,Ei,D}); }
    }
    Section(Terrain,0,V,I,C,true);
}
void ACyberquestUniverse::BuildForests()
{
    int32 Budget=360;
    for(const auto& D:Datasets)
    {
        if(D.Form==TEXT("peak")) continue; FRandomStream R(FCrc::StrCrc32(*D.Id)); const int32 Count=FMath::Min(Budget,FMath::RoundToInt(30+40*D.Abundance)); Budget-=Count;
        for(int32 Index=0;Index<Count;++Index)
        {
            const float A=Index*2.399963f+R.FRandRange(-.1,.1), Radius=D.Radius*(.25f+.6f*FMath::Sqrt((Index+.5f)/Count));
            const float E=D.Anchor.X+FMath::Cos(A)*Radius,N=D.Anchor.Y+FMath::Sin(A)*Radius,H=GetHeightMetres(E,N),Tall=R.FRandRange(2,4.5);
            Trunks->AddInstance(FTransform(FRotator::ZeroRotator,FVector(E,N,H+Tall*.25f)*100,FVector(.12f,.12f,Tall*.5f)));
            Canopies->AddInstance(FTransform(FRotator::ZeroRotator,FVector(E,N,H+Tall*.65f)*100,FVector(Tall*.4f,Tall*.4f,Tall*.8f)));
        }
    }
}
void ACyberquestUniverse::BuildRivers()
{
    const TArray<TSharedPtr<FJsonValue>>* Flows=nullptr; if(!Manifest.IsValid() || !Manifest->TryGetArrayField(TEXT("flows"),Flows)) return;
    int32 Index=0;
    for(const auto& Value:*Flows)
    {
        if(Index>=48 || !Value.IsValid() || Value->Type!=EJson::Object) continue; const auto O=Value->AsObject();
        const auto* A=FindDataset(Text(O,TEXT("from"),Text(O,TEXT("fromDatasetId")))); const auto* B=FindDataset(Text(O,TEXT("to"),Text(O,TEXT("toDatasetId")))); if(!A || !B) continue;
        const FString Kind=Text(O,TEXT("kind"),TEXT("information-flow")); const bool Drainage=Kind==TEXT("simulated-drainage");
        TArray<FVector2D> Path; const TArray<TSharedPtr<FJsonValue>>* Points=nullptr;
        if(O->TryGetArrayField(TEXT("points"),Points))for(const auto& Point:*Points)
        {
            if(Path.Num()>=2048 || !Point.IsValid() || Point->Type!=EJson::Object)continue;const auto P=Point->AsObject();
            double East,North;
            if(P->TryGetNumberField(TEXT("x"),East) && P->TryGetNumberField(TEXT("z"),North) && FMath::IsFinite(East) && FMath::IsFinite(North) && FMath::Abs(East)<=Extent && FMath::Abs(North)<=Extent)
            {
                const FVector2D Position(East,North);if(Path.IsEmpty() || FVector2D::DistSquared(Path.Last(),Position)>.000001f)Path.Add(Position);
            }
        }
        // Legacy descriptors without a path may still define an authored
        // source-to-target transfer. Same-dataset drainage requires its path.
        if(Path.Num()<2 && A!=B && !Drainage)
        {
            const float Length=FVector2D::Distance(A->Anchor,B->Anchor);const int32 Steps=FMath::Max(2,FMath::CeilToInt(Length/.7f));Path.Reset();
            for(int32 J=0;J<=Steps;++J)Path.Add(FMath::Lerp(A->Anchor,B->Anchor,static_cast<float>(J)/Steps));
        }
        if(Path.Num()<2)continue;
        const float HalfWidth=Number(O,TEXT("width"),.65f,.15f,2.f)*.5f;
        TArray<FVector> V;TArray<int32>I;TArray<FLinearColor>C;float Previous=BIG_NUMBER;bool Uphill=false;
        for(int32 J=0;J<Path.Num();++J)
        {
            const auto P=Path[J],Before=Path[FMath::Max(0,J-1)],After=Path[FMath::Min(Path.Num()-1,J+1)];
            const auto Direction=(After-Before).GetSafeNormal();const FVector2D Side(-Direction.Y,Direction.X);
            const float H=GetHeightMetres(P.X,P.Y);Uphill|=H>Previous+.01f;Previous=H;
            for(int32 S=-1;S<=1;S+=2){const auto Q=P+Side*(HalfWidth*S);V.Add(FVector(Q.X,Q.Y,GetHeightMetres(Q.X,Q.Y)+.13f)*100);C.Add(Drainage?FLinearColor(.08f,.35f,.5f):FLinearColor(.15f,.7f,.85f));}
            if(J<Path.Num()-1){const int32 K=J*2;I.Append({K,K+2,K+1,K+1,K+2,K+3});}
        }
        Section(Rivers,Index++,V,I,C,false);
        if(Uphill)UE_LOG(LogCyberquest,Warning,TEXT("%s %s -> %s includes uphill reaches. Information transfers need transport energy; drainage paths must be recomputed after terrain changes."),*Kind,*A->Id,*B->Id);
    }
}
void ACyberquestUniverse::BuildGlaciers()
{
    const TArray<TSharedPtr<FJsonValue>>* Caps=nullptr; if(!Manifest.IsValid() || !Manifest->TryGetArrayField(TEXT("glaciers"),Caps)) return; int32 Index=0;
    for(const auto& Value:*Caps)
    {
        if(Index>=64 || !Value.IsValid() || Value->Type!=EJson::Object) continue; const auto O=Value->AsObject(); const auto* D=FindDataset(Text(O,TEXT("datasetId"))); if(!D || D->Form!=TEXT("peak"))continue;
        const float Radius=Number(O,TEXT("radius"),D->Radius*.34f,1,D->Radius*.65f); TArray<FVector>V; TArray<int32>I; TArray<FLinearColor>C;
        constexpr int32 Rings=12, Segments=48;
        // A center-to-rim fan cuts beneath a curved summit. Sample concentric
        // rings instead; a small curvature allowance keeps the linear facets
        // above the analytic terrain, including unusually steep custom peaks.
        const float Lift=.15f+FMath::Abs(D->Relief)*FMath::Square(Radius/D->Radius/Rings);
        V.Add(FVector(D->Anchor.X,D->Anchor.Y,GetHeightMetres(D->Anchor.X,D->Anchor.Y)+Lift)*100); C.Add(FLinearColor(.76f,.91f,1));
        for(int32 Ring=1;Ring<=Rings;++Ring) for(int32 J=0;J<Segments;++J)
        {
            const float A=J*2*PI/Segments; const auto P=D->Anchor+FVector2D(FMath::Cos(A),FMath::Sin(A))*(Radius*Ring/Rings);
            V.Add(FVector(P.X,P.Y,GetHeightMetres(P.X,P.Y)+Lift)*100); C.Add(FLinearColor(.65f,.82f,.95f));
            const int32 Current=1+(Ring-1)*Segments+J,Next=1+(Ring-1)*Segments+(J+1)%Segments;
            if(Ring==1) I.Append({0,Current,Next});
            else
            {
                const int32 Inner=Current-Segments,InnerNext=Next-Segments;
                I.Append({Inner,Current,Next,Inner,Next,InnerNext});
            }
        }
        Section(Glaciers,Index++,V,I,C,false);
    }
}
float ACyberquestUniverse::LakeBoundaryRadius(const FCyberquestLake& L,float Angle,float Clearance) const
{
    float Low=0,High=L.Radius;
    if(GetHeightMetres(L.Center.X,L.Center.Y)>=L.WaterLevel-Clearance)return 0;
    const FVector2D Direction(FMath::Cos(Angle),FMath::Sin(Angle));
    for(int32 I=0;I<18;++I) { const float Mid=(Low+High)*.5f;const auto P=L.Center+Direction*Mid;
        if(GetHeightMetres(P.X,P.Y)<L.WaterLevel-Clearance)Low=Mid;else High=Mid; }
    return Low;
}
bool ACyberquestUniverse::GetLakeNavigation(const FString& LakeId,FVector& CenterMetres,float& NavigableRadiusMetres) const
{
    for(const auto& L:Lakes) if(LakeId.IsEmpty() || L.Id==LakeId)
    {
        float Radius=L.Radius;
        for(int32 I=0;I<32;++I)Radius=FMath::Min(Radius,LakeBoundaryRadius(L,I*2*PI/32,.25f));
        CenterMetres=FVector(L.Center.X,L.Center.Y,L.WaterLevel);NavigableRadiusMetres=FMath::Max(0.f,Radius-1.6f);
        return NavigableRadiusMetres>2;
    }
    return false;
}
bool ACyberquestUniverse::SetBoatPose(FVector PositionMetres,float YawRadians)
{
    if(PositionMetres.ContainsNaN() || !FMath::IsFinite(YawRadians))return false;
    for(const auto& L:Lakes)
    {
        if(FVector2D::DistSquared(FVector2D(PositionMetres.X,PositionMetres.Y),L.Center)>FMath::Square(L.Radius) || GetHeightMetres(PositionMetres.X,PositionMetres.Y)>L.WaterLevel-.25f)continue;
        PositionMetres.Z=L.WaterLevel+.1f;
        Boat->SetRelativeLocationAndRotation(PositionMetres*100,FRotator(0,90.f-FMath::RadiansToDegrees(YawRadians),0));
        Boat->SetRelativeScale3D(FVector(2.8f,1.1f,.35f));Boat->SetVisibility(true);return true;
    }
    return false;
}
void ACyberquestUniverse::BuildLakes()
{
    int32 Index=0;
    auto Timber=[&](FVector P,FVector Size) { DockTimber->AddInstance(FTransform(FRotator::ZeroRotator,P*100,Size)); };
    for(const auto& L:Lakes)
    {
        if(GetHeightMetres(L.Center.X,L.Center.Y)>=L.WaterLevel)continue;
        TArray<FVector>V;TArray<int32>I;TArray<FLinearColor>C;constexpr int32 Segments=96;
        V.Add(FVector(L.Center.X,L.Center.Y,L.WaterLevel)*100);C.Add(FLinearColor(.035f,.27f,.43f));
        for(int32 J=0;J<Segments;++J)
        {
            const float A=J*2*PI/Segments;const auto P=L.Center+FVector2D(FMath::Cos(A),FMath::Sin(A))*LakeBoundaryRadius(L,A);
            V.Add(FVector(P.X,P.Y,L.WaterLevel)*100);C.Add(FLinearColor(.08f,.43f,.55f));I.Append({0,J+1,(J+1)%Segments+1});
        }
        Section(LakesMesh,Index++,V,I,C,false);
        // One simple open-front shoreline boathouse and a dock per lake.
        // Timber is decorative in this inspection pass, not a structure solver.
        const float Shore=L.Center.X+L.Radius*.94f,N=L.Center.Y,Deck=FMath::Max(GetHeightMetres(Shore,N)+.25f,L.WaterLevel+.65f);
        Timber(FVector(Shore,N,Deck),FVector(3.2f,3.2f,.2f));
        Timber(FVector(Shore+1.5f,N,Deck+1.35f),FVector(.16f,3.2f,2.7f));
        Timber(FVector(Shore,N-1.5f,Deck+1.35f),FVector(3.2f,.16f,2.7f));
        Timber(FVector(Shore,N+1.5f,Deck+1.35f),FVector(3.2f,.16f,2.7f));
        Timber(FVector(Shore,N,Deck+2.85f),FVector(3.55f,3.55f,.25f));
        const float Start=L.Center.X+L.Radius*.25f,End=Shore-1.6f;
        Timber(FVector((Start+End)*.5f,N,Deck-.1f),FVector(FMath::Max(.5f,End-Start),1.2f,.18f));
        for(int32 J=0;J<4;++J)for(int32 Side=-1;Side<=1;Side+=2)
        { const float E=Start+(End-Start)*J/3,Ground=GetHeightMetres(E,N+Side*.48f);Timber(FVector(E,N+Side*.48f,(Ground+Deck)*.5f),FVector(.12f,.12f,FMath::Max(.3f,Deck-Ground))); }
        FVector Center;float Radius;
        if(Index==1 && GetLakeNavigation(L.Id,Center,Radius))SetBoatPose(Center+FVector(Radius*.55f,-1.5f,0),PI/2);
        UE_LOG(LogCyberquest,Display,TEXT("Data lake %s: bounded water basin, authored shoreline boathouse, decorative dock. Manifest datasetIds describe membership; no authorization or storage backend is implied."),*L.Id);
    }
}
bool ACyberquestUniverse::RebuildUniverse()
{
    // A failed refresh preserves the existing mesh and its matching field data.
    const auto PreviousDatasets=Datasets;const auto PreviousLakes=Lakes;const auto PreviousManifest=Manifest;
    const float PreviousBaseline=Baseline,PreviousExtent=Extent;const FString PreviousWindow=DataWindow,PreviousSummary=SourceSummary;
    if(!LoadManifest()) { Datasets=PreviousDatasets;Lakes=PreviousLakes;Manifest=PreviousManifest;Baseline=PreviousBaseline;Extent=PreviousExtent;DataWindow=PreviousWindow;SourceSummary=PreviousSummary;return false; }
    Terrain->ClearAllMeshSections(); Rivers->ClearAllMeshSections(); Glaciers->ClearAllMeshSections(); LakesMesh->ClearAllMeshSections();
    Trunks->ClearInstances(); Canopies->ClearInstances(); DockTimber->ClearInstances(); AvalancheRocks->ClearInstances(); Boat->SetVisibility(false); Debris.Reset();
    BuildTerrain(); BuildForests(); BuildRivers(); BuildGlaciers(); BuildLakes(); ApplyMaterials(); return true;
}
bool ACyberquestUniverse::TriggerAvalanche(const FString& DatasetId,int32 ParticleCount)
{
    const auto* D=FindDataset(DatasetId); if(!D || D->Form!=TEXT("peak")) return false;
    Debris.Reset(); AvalancheRocks->ClearInstances(); FRandomStream R(FCrc::StrCrc32(*DatasetId));
    for(int32 I=0;I<FMath::Clamp(ParticleCount,1,128);++I)
    {
        const float A=R.FRandRange(-.5,.5),Rad=D->Radius*R.FRandRange(.15,.35); FCyberquestDebris P;
        P.Position=FVector(D->Anchor.X+FMath::Cos(A)*Rad,D->Anchor.Y+FMath::Sin(A)*Rad,0); P.Position.Z=GetHeightMetres(P.Position.X,P.Position.Y)+.35f;
        Debris.Add(P); AvalancheRocks->AddInstance(FTransform(FRotator::ZeroRotator,P.Position*100,FVector(.7f)));
    }
    UE_LOG(LogCyberquest,Display,TEXT("Authored avalanche scenario on %s: visual slope-driven debris, not a financial prediction or rigid-body contact simulation."),*DatasetId); return true;
}
void ACyberquestUniverse::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds); const float Dt=FMath::Clamp(DeltaSeconds,0.f,.1f); const int32 Steps=FMath::Max(1,FMath::CeilToInt(Dt/.02f));
    for(int32 I=0;I<Debris.Num();++I)
    {
        auto& P=Debris[I]; if(P.Age>18.f)continue;
        for(int32 S=0;S<Steps;++S) { const float H=Dt/Steps; const auto G=Gradient(P.Position.X,P.Position.Y); const float Denom=1+G.SizeSquared();
            P.Velocity.X+=-9.81f*G.X/Denom*H; P.Velocity.Y+=-9.81f*G.Y/Denom*H;
            P.Velocity*=FMath::Exp(-.35f*H); P.Position+=P.Velocity*H; P.Position.Z=GetHeightMetres(P.Position.X,P.Position.Y)+.35f; P.Age+=H; }
        AvalancheRocks->UpdateInstanceTransform(I,FTransform(FRotator(0,P.Age*80,0),P.Position*100,FVector(.7f)),false,I==Debris.Num()-1,true);
    }
}
