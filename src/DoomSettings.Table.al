/// <summary>
/// DOOM's settings per game (WAD file) and user: the config file DOOM writes when a setting changes
/// (volumes, mouse sensitivity, screen size, gamma, ...) and reads at startup.
/// </summary>
table 66602 "DOOM Settings"
{
    Caption = 'DOOM Settings';
    DataClassification = CustomerContent;
    DataPerCompany = false;

    fields
    {
        field(1; Game; Text[250])
        {
            Caption = 'Game (WAD file)';
        }
        field(2; "User ID"; Code[50])
        {
            Caption = 'User ID';
            DataClassification = EndUserIdentifiableInformation;
        }
        field(3; Config; Blob)
        {
            Caption = 'Config';
        }
        field(4; Size; Integer)
        {
            Caption = 'Size (bytes)';
        }
        field(5; "Modified At"; DateTime)
        {
            Caption = 'Modified At';
        }
    }

    keys
    {
        key(PK; Game, "User ID")
        {
            Clustered = true;
        }
    }
}
