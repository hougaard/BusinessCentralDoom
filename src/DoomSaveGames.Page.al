/// <summary>Lists the DOOM save games. Save and load them in the game (F2 / F3); delete them here.</summary>
page 66601 "DOOM Save Games"
{
    PageType = List;
    Caption = 'DOOM Save Games';
    ApplicationArea = All;
    UsageCategory = Lists;
    SourceTable = "DOOM Save Game";
    InsertAllowed = false;
    ModifyAllowed = false;
    DeleteAllowed = true;

    layout
    {
        area(Content)
        {
            repeater(Saves)
            {
                field(Game; Rec.Game)
                {
                }
                field("User ID"; Rec."User ID")
                {
                }
                field("Slot No."; Rec."Slot No." + 1)
                {
                    Caption = 'Slot';
                    ToolTip = 'The save slot in the game''s Save Game and Load Game menus.';
                }
                field(Description; Rec.Description)
                {
                }
                field(Level; Rec.Level)
                {
                }
                field(Skill; Rec.Skill)
                {
                }
                field("Saved At"; Rec."Saved At")
                {
                }
                field(Size; Rec.Size)
                {
                }
            }
        }
    }
}
